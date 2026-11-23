from tests.mockdb import mock_collection
import pytest
import shapely
from fastapi.testclient import TestClient
from shapely.geometry import shape

from safira_ml.extract import to_mongo_documents
from safira_ml.persistence import save_bundle
from safira_ml.route_profile import corridor_polygon, summarise_route
from safira_ml.service.app import ModelRegistry, ServiceSettings, create_app
from safira_ml.store import SegmentStore
from safira_ml.training import train_model

KEY = "test-key"
HEADERS = {"X-API-Key": KEY}


class LocalStore(SegmentStore):
    """mongomock has no $geoIntersects; emulate the geo query with shapely for the tests."""

    def find_near(self, city_id, polygon_geojson, limit=20000):
        polygon = shape(polygon_geojson)
        return [d for d in self.collection.find({"cityId": city_id}, {"_id": 0})
                if shape(d["geometry"]).intersects(polygon)][:limit]


@pytest.fixture(scope="module")
def env(city_frames, params, tmp_path_factory):
    frames, metas = city_frames
    root = tmp_path_factory.mktemp("models")
    store = LocalStore(mock_collection())
    for city in frames:
        store.upsert_city(to_mongo_documents(frames[city], metas[city]), metas[city]["runId"])
    result = train_model(store.training_frame(), "global", params)
    save_bundle(result.bundle, root)
    store.assign_clusters(result.bundle)
    app = create_app(ServiceSettings(api_key=KEY, model_root=root), store=store,
                     registry=ModelRegistry(root))
    return TestClient(app), result.bundle, store, frames


def _route_through(frames, city="jalandhar"):
    row = frames[city][frames[city].way_osm_id == frames[city].way_osm_id.iloc[200]]
    shapes = shapely.from_wkt(row["geometry_wkt"].to_numpy())
    coords = [c for g in shapes for c in g.coords]
    return [[x, y] for x, y in coords]


def test_corridor_is_a_valid_polygon_around_the_route(env):
    coords = _route_through(env[3])
    polygon = shape(corridor_polygon(coords))
    assert polygon.is_valid and polygon.geom_type == "Polygon"
    assert polygon.contains(shapely.geometry.LineString(coords).centroid)


def test_summary_reports_unmatched_instead_of_guessing(env):
    coords = _route_through(env[3])
    (x0, y0), (x1, y1) = coords[0], coords[-1]
    far = [x1 + (x1 - x0) * 0.5, y1 + (y1 - y0) * 0.5]       # continues straight past the end of the way
    route = coords + [far]
    store = env[2]
    docs = store.find_near("jalandhar", corridor_polygon(route))
    resolved = [{"geometry": d["geometry"], "clusterId": d["modelAssignment"]["clusterId"],
                 "clusterName": d["modelAssignment"]["clusterName"]} for d in docs]
    summary = summarise_route(route, resolved)
    assert summary["unmatchedLengthMeters"] > 0.3 * summary["routeLengthMeters"]
    assert 55 < summary["assignedCoveragePercent"] < 75      # ~2/3 of the route lies on mapped segments
    assert summary["clusterShares"] and summary["dominantCluster"]
    total = summary["assignedLengthMeters"] + summary["unassignedLengthMeters"] + summary["unmatchedLengthMeters"]
    assert abs(total - summary["routeLengthMeters"]) < 1.0
    # a route wholly outside the stored network is entirely unmatched, never assigned a cluster
    nothing = summarise_route([[75.9, 31.9], [75.91, 31.9]], [])
    assert nothing["assignedCoveragePercent"] == 0 and nothing["dominantCluster"] is None
    assert nothing["unmatchedLengthMeters"] == nothing["routeLengthMeters"]


def test_api_requires_key_and_fails_closed(env):
    client, *_ = env
    assert client.get("/health").status_code == 200
    assert client.get("/v1/model/profiles").status_code == 401
    assert client.get("/v1/model/profiles", headers={"X-API-Key": "wrong"}).status_code == 401
    unconfigured = TestClient(create_app(ServiceSettings(api_key=None)))
    assert unconfigured.get("/v1/model/profiles", headers=HEADERS).status_code == 503


def test_profiles_endpoint_returns_names_and_feature_info(env):
    client, bundle, *_ = env
    body = client.get("/v1/model/profiles", headers=HEADERS).json()
    assert body["modelVersion"] == bundle.version
    assert {c["name"] for c in body["clusters"]} == set(bundle.cluster_names().values())
    assert "police_nearest_m" in body["featureInfo"] and "pharmacy_count" in body["droppedFeatures"]
    assert "not crime predictions" in body["disclaimer"]


def test_assign_endpoint_uses_saved_model(env):
    client, bundle, store, _ = env
    doc = store.collection.find_one({"cityId": "jalandhar"})
    payload = {"segments": [
        {"id": "a", "roadGroup": doc["roadGroup"], "features": doc["features"]},
        {"id": "b", "roadGroup": "local", "features": {"police_nearest_m": None}},
    ]}
    body = client.post("/v1/segments/assign", json=payload, headers=HEADERS).json()
    assert body["modelVersion"] == bundle.version
    assert body["assignments"][0]["clusterId"] == doc["modelAssignment"]["clusterId"]
    assert body["assignments"][1]["imputedFeatures"]          # unknown values are reported
    assert client.post("/v1/segments/assign", json={"segments": []}, headers=HEADERS).status_code == 422


def test_route_profile_endpoint(env):
    client, bundle, _, frames = env
    coords = _route_through(frames)
    body = client.post("/v1/routes/profile", headers=HEADERS, json={
        "cityId": "jalandhar", "routes": [{"id": 0, "coordinates": coords}]}).json()
    route = body["routes"][0]
    assert body["modelVersion"] == bundle.version and route["routeId"] == 0
    assert route["assignedCoveragePercent"] > 90 and route["clusterShares"]
    assert client.post("/v1/routes/profile", headers=HEADERS, json={
        "cityId": "atlantis", "routes": [{"id": 0, "coordinates": coords}]}).status_code == 422


def test_route_profile_recomputes_when_assignment_is_stale(env):
    client, bundle, store, frames = env
    store.collection.update_many({"cityId": "jalandhar"}, {"$set": {"modelAssignment.modelVersion": "old"}})
    coords = _route_through(frames)
    body = client.post("/v1/routes/profile", headers=HEADERS, json={
        "cityId": "jalandhar", "routes": [{"id": 1, "coordinates": coords}]}).json()
    assert body["routes"][0]["assignedCoveragePercent"] > 90      # recomputed on the fly with the active model
