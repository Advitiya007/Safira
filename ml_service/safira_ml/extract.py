"""Feature extraction pipeline: GeographicFeature documents -> road-segment features."""

from __future__ import annotations

import json
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator, Optional, Protocol

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import LineString, MultiLineString, Polygon

from . import tags as T
from .config import (
    CITY_BOUNDING_BOXES, GEOGRAPHIC_COLLECTION, PIPELINE_VERSION, RAW_FEATURE_COLUMNS,
    SUPPORTED_CITIES, ExtractionParams,
)
from .features import POI_CLASSES, PoiLayer, compute_features
from .geo import WGS84, poi_geometry, project, to_shapely, utm_crs_for
from .segmentation import RoadWay, build_segments, to_wgs84

DOC_PROJECTION = {
    "_id": 0, "osmType": 1, "osmId": 1, "geometry": 1, "tags": 1,
    "dataVersion": 1, "importRunId": 1, "sourceTimestamp": 1,
}


class FeatureSource(Protocol):
    def load(self, city_id: str) -> Iterable[dict]: ...


class MongoFeatureSource:
    """Read-only access to ``GeographicFeature``. Never writes to that collection."""

    def __init__(self, database, collection: str = GEOGRAPHIC_COLLECTION):
        self._collection = database[collection]

    def load(self, city_id: str) -> Iterator[dict]:
        cursor = self._collection.find({"cityId": city_id}, DOC_PROJECTION, batch_size=2000)
        yield from cursor


class FileFeatureSource:
    """JSON-lines file of GeographicFeature-shaped documents (offline / reproducible runs)."""

    def __init__(self, path: Path):
        self._path = Path(path)

    def load(self, city_id: str) -> Iterator[dict]:
        with self._path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                doc = json.loads(line)
                if doc.get("cityId", city_id) == city_id:
                    yield doc


def classify_documents(docs: Iterable[dict]):
    roads: list[RoadWay] = []
    pois: dict[str, list] = {name: [] for name in POI_CLASSES}
    stats: Counter = Counter()
    versions: set = set()
    import_runs: set = set()
    newest_source = None
    for doc in docs:
        stats["documents"] += 1
        if doc.get("dataVersion"):
            versions.add(str(doc["dataVersion"]))
        if doc.get("importRunId"):
            import_runs.add(str(doc["importRunId"]))
        stamp = doc.get("sourceTimestamp")
        if stamp is not None and (newest_source is None or stamp > newest_source):
            newest_source = stamp
        tags = doc.get("tags") or {}
        geom = to_shapely(doc.get("geometry"))
        if geom is None:
            stats["invalid_geometry"] += 1
            continue
        highway = T.road_highway(tags)
        if highway:
            if isinstance(geom, LineString) and not T.is_area_tagged(tags):
                roads.append(RoadWay(str(doc.get("osmId")), highway, list(geom.coords), tags))
                stats["road_ways"] += 1
                continue
            if isinstance(geom, (MultiLineString, Polygon)) or T.is_area_tagged(tags):
                stats["road_non_linestring_skipped"] += 1
                continue
        poi_geom = None
        for name, predicate in T.POI_PREDICATES.items():
            if predicate(tags):
                poi_geom = poi_geom if poi_geom is not None else poi_geometry(geom)
                pois[name].append(poi_geom)
    for name in POI_CLASSES:
        stats[f"poi_{name}"] = len(pois[name])
    meta = {
        "dataVersions": sorted(versions),
        "importRunIds": sorted(import_runs),
        "newestSourceTimestamp": newest_source.isoformat() if hasattr(newest_source, "isoformat") else newest_source,
    }
    return roads, pois, stats, meta


def _bbox_polygon_proj(city_id: str, crs):
    box = CITY_BOUNDING_BOXES.get(city_id)
    if box is None:
        return None
    ring = [(box["west"], box["south"]), (box["east"], box["south"]),
            (box["east"], box["north"]), (box["west"], box["north"]), (box["west"], box["south"])]
    projected = project([Polygon(ring)], crs)[0]
    return projected


def extract_city(
    city_id: str, docs: Iterable[dict], params: Optional[ExtractionParams] = None
) -> tuple[pd.DataFrame, dict]:
    """Return (dataframe, metadata). One row per road segment."""
    params = params or ExtractionParams()
    roads, pois, stats, source_meta = classify_documents(docs)
    if not roads:
        raise ValueError(f"No road ways found for city '{city_id}'; import OSM data first")

    box = CITY_BOUNDING_BOXES.get(city_id)
    if box:
        crs = utm_crs_for((box["west"] + box["east"]) / 2, (box["south"] + box["north"]) / 2)
    else:
        first = roads[0].coords[0]
        crs = utm_crs_for(first[0], first[1])

    segments = build_segments(roads, crs, params)
    layers = {
        name: PoiLayer.from_geoms(project(geoms, crs) if geoms else [])
        for name, geoms in pois.items()
    }
    feats = compute_features(segments, layers, _bbox_polygon_proj(city_id, crs), params)
    wgs = to_wgs84(segments)
    midpoints = shapely.line_interpolate_point(wgs.to_numpy(), 0.5, normalized=True)

    frame = pd.DataFrame({
        "segment_key": segments["segment_key"].to_numpy(),
        "cityId": city_id,
        "way_osm_id": segments["way_osm_id"].to_numpy(),
        "road_type": segments["highway"].to_numpy(),
        "road_group": segments["road_group"].to_numpy(),
        "is_short": segments["is_short"].to_numpy(),
        "mid_lon": shapely.get_x(midpoints),
        "mid_lat": shapely.get_y(midpoints),
    })
    for column in ("length_m", "foot_access", "vehicle_access", "sidewalk_present", "lit_tag"):
        frame[column] = segments[column].to_numpy()
    for column in feats.columns:
        frame[column] = feats[column].to_numpy()
    frame["geometry_wkt"] = shapely.to_wkt(wgs.to_numpy(), rounding_precision=7)

    availability = {name: bool(len(layers[name])) for name in POI_CLASSES}
    meta = {
        "runId": uuid.uuid4().hex,
        "cityId": city_id,
        "extractedAt": datetime.now(timezone.utc).isoformat(),
        "pipelineVersion": PIPELINE_VERSION,
        "projectedCrs": crs.to_string(),
        "params": params.to_dict(),
        "counts": {
            "documents": stats["documents"],
            "roadWays": stats["road_ways"],
            "segments": int(len(frame)),
            "shortSegments": int(frame["is_short"].sum()),
            "invalidGeometry": stats["invalid_geometry"],
            "roadNonLinestringSkipped": stats["road_non_linestring_skipped"],
            "poi": {name: stats[f"poi_{name}"] for name in POI_CLASSES},
        },
        "classAvailability": availability,
        **source_meta,
    }
    return frame, meta


# ---- outputs -------------------------------------------------------------------------

CSV_COLUMNS = [
    "segment_key", "cityId", "way_osm_id", "road_type", "road_group", "is_short",
    "mid_lon", "mid_lat", *RAW_FEATURE_COLUMNS, "lit_tag",
    "bbox_edge_distance_m", "near_bbox_edge", "geometry_wkt",
]


def write_city_csv(frame: pd.DataFrame, meta: dict, path: Path) -> Path:
    """Replace this city's rows in the combined CSV (other cities are kept)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    out = frame.copy()
    out["extraction_run_id"] = meta["runId"]
    out["extracted_at"] = meta["extractedAt"]
    if path.exists():
        existing = pd.read_csv(path, low_memory=False)
        existing = existing[existing["cityId"] != meta["cityId"]]
        out = pd.concat([existing, out], ignore_index=True)
    columns = [c for c in [*CSV_COLUMNS, "extraction_run_id", "extracted_at"] if c in out.columns]
    temporary = path.with_suffix(".csv.tmp")
    out[columns].to_csv(temporary, index=False, float_format="%.6g")
    temporary.replace(path)
    return path


def _clean(value):
    if isinstance(value, (float, np.floating)):
        return None if not np.isfinite(value) else float(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    return value


def to_mongo_documents(frame: pd.DataFrame, meta: dict) -> list[dict]:
    """Convert to RoadSegmentFeature documents. NaN -> null so unknown stays distinct from 0."""
    wkt_geoms = shapely.from_wkt(frame["geometry_wkt"].to_numpy())
    extraction = {
        "runId": meta["runId"],
        "extractedAt": datetime.fromisoformat(meta["extractedAt"]),
        "pipelineVersion": meta["pipelineVersion"],
        "params": meta["params"],
        "sourceDataVersions": meta["dataVersions"],
        "sourceImportRunIds": meta["importRunIds"],
        "classAvailability": meta["classAvailability"],
    }
    feature_cols = [c for c in RAW_FEATURE_COLUMNS]
    docs = []
    for position, row in enumerate(frame.to_dict("records")):
        features = {}
        for column in feature_cols:
            value = _clean(row.get(column))
            if value is not None and column.endswith("_count"):
                value = int(value)
            features[column] = value
        docs.append({
            "cityId": row["cityId"],
            "segmentKey": row["segment_key"],
            "osmWayId": row["way_osm_id"],
            "roadType": row["road_type"],
            "roadGroup": row["road_group"],
            "geometry": shapely.geometry.mapping(wkt_geoms[position]),
            "midpoint": {"type": "Point", "coordinates": [row["mid_lon"], row["mid_lat"]]},
            "features": features,
            "informational": {"litTag": _clean(row.get("lit_tag"))},
            "flags": {
                "isShort": bool(row["is_short"]),
                "nearBboxEdge": bool(row["near_bbox_edge"]),
                "bboxEdgeDistanceMeters": _clean(row["bbox_edge_distance_m"]),
            },
            "extraction": extraction,
            "modelAssignment": None,
        })
    return docs
