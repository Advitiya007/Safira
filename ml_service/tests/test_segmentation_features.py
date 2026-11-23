import math

import numpy as np
import pytest

from safira_ml import tags as T
from safira_ml.extract import extract_city
from safira_ml.segmentation import find_junctions, split_at_junctions, RoadWay

LON, LAT = 75.57, 31.33


def way(osm_id, coords, highway="residential", **tags):
    return {"cityId": "jalandhar", "osmType": "way", "osmId": str(osm_id),
            "geometry": {"type": "LineString", "coordinates": coords}, "tags": {"highway": highway, **tags}}


def poi(osm_id, lon, lat, **tags):
    return {"cityId": "jalandhar", "osmType": "node", "osmId": str(osm_id),
            "geometry": {"type": "Point", "coordinates": [lon, lat]}, "tags": tags}


def test_splits_at_shared_vertex_only():
    a = [(LON, LAT), (LON + 0.001, LAT), (LON + 0.002, LAT)]
    b = [(LON + 0.001, LAT - 0.001), (LON + 0.001, LAT), (LON + 0.001, LAT + 0.001)]
    junctions = find_junctions([RoadWay("1", "residential", a), RoadWay("2", "residential", b)], 7)
    assert junctions == {(round(LON + 0.001, 7), round(LAT, 7))}
    assert [len(p) for p in split_at_junctions(a, junctions, 7)] == [2, 2]


def test_crossing_without_shared_node_is_not_a_junction():
    a = [(LON, LAT), (LON + 0.002, LAT)]
    b = [(LON + 0.001, LAT - 0.001), (LON + 0.001, LAT + 0.001)]  # bridge: no shared vertex
    assert find_junctions([RoadWay("1", "residential", a), RoadWay("2", "residential", b)], 7) == set()


def test_long_pieces_are_capped_and_highway_nodes_ignored():
    docs = [way(1, [[LON, LAT], [LON + 0.01, LAT]]),  # ~950 m
            {"cityId": "jalandhar", "osmType": "node", "osmId": "9",
             "geometry": {"type": "Point", "coordinates": [LON, LAT]}, "tags": {"highway": "traffic_signals"}}]
    frame, meta = extract_city("jalandhar", docs)
    assert len(frame) == math.ceil(frame["length_m"].sum() / 200)
    assert frame["length_m"].max() <= 200.01
    assert meta["counts"]["roadWays"] == 1


def test_area_roads_and_invalid_geometry_are_skipped():
    docs = [way(1, [[LON, LAT], [LON + 0.002, LAT]]),
            way(2, [[LON, LAT], [LON + 0.001, LAT], [LON + 0.001, LAT + 0.001], [LON, LAT]], "pedestrian", area="yes"),
            {"cityId": "jalandhar", "osmType": "way", "osmId": "3",
             "geometry": {"type": "LineString", "coordinates": [[LON, LAT], [float("nan"), LAT]]},
             "tags": {"highway": "residential"}}]
    frame, meta = extract_city("jalandhar", docs)
    assert meta["counts"]["roadWays"] == 1
    assert meta["counts"]["roadNonLinestringSkipped"] == 1
    assert meta["counts"]["invalidGeometry"] == 1


def test_missing_class_is_nan_not_zero_but_empty_radius_is_real_zero():
    road = way(1, [[LON, LAT], [LON + 0.002, LAT]])
    far_police = poi(2, LON + 0.05, LAT, amenity="police")  # ~4.7 km away: exists, outside radius
    frame, meta = extract_city("jalandhar", [road, far_police])
    assert (frame["police_count"] == 0).all()                    # genuine zero
    assert frame["police_nearest_m"].min() > 4000                 # real distance still reported
    assert frame["pharmacy_count"].isna().all()                   # class absent -> unknown
    assert frame["pharmacy_nearest_m"].isna().all()
    assert meta["classAvailability"]["pharmacy"] is False


def test_counts_and_distance_for_point_poi():
    road = way(1, [[LON, LAT], [LON + 0.0018, LAT]])  # ~170 m
    shop = poi(2, LON + 0.0009, LAT + 0.0009, shop="convenience")  # ~100 m north of midpoint
    frame, _ = extract_city("jalandhar", [road, shop])
    assert frame["shop_count"].iloc[0] == 1
    assert frame["establishment_count"].iloc[0] == 1
    assert frame["establishment_density_per_km2"].iloc[0] > 0


def test_closed_way_hospital_is_treated_as_area():
    road = way(1, [[LON, LAT], [LON + 0.002, LAT]])
    ring = [[LON, LAT + 0.0005], [LON + 0.002, LAT + 0.0005], [LON + 0.002, LAT + 0.0015],
            [LON, LAT + 0.0015], [LON, LAT + 0.0005]]
    area = {"cityId": "jalandhar", "osmType": "way", "osmId": "5",
            "geometry": {"type": "LineString", "coordinates": ring}, "tags": {"amenity": "hospital"}}
    frame, _ = extract_city("jalandhar", [road, area])
    assert frame["hospital_count"].iloc[0] == 1
    assert 40 < frame["hospital_nearest_m"].iloc[0] < 70  # ~55 m to the polygon edge


def test_accessibility_only_from_explicit_tags():
    assert T.foot_access({"foot": "designated"}) == 1.0
    assert T.foot_access({"foot": "no"}) == 0.0
    assert math.isnan(T.foot_access({"highway": "footway"}))       # not inferred from highway type
    assert math.isnan(T.vehicle_access({"motor_vehicle": "destination"}))
    assert T.sidewalk_present({"sidewalk:left": "yes"}) == 1.0
    assert math.isnan(T.sidewalk_present({}))


def test_classifiers_mirror_scoring_definitions():
    assert T.is_hospital({"amenity": "clinic"}) and T.is_pharmacy({"amenity": "pharmacy"})
    assert T.is_establishment({"amenity": "pharmacy"}) and T.is_establishment({"shop": "yes"})
    assert not T.is_establishment({"shop": "no"})
    assert T.is_public_transport({"highway": "bus_stop"})
    assert not T.is_public_transport({"public_transport": "platform"})
