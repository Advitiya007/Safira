"""Geometry and time helpers for the dataset builder. Pure functions; no labelling decisions live here.

Distances are metric distances in the city's UTM projection (``geo.utm_crs_for`` at the city bbox centre, the
same projection ``extract`` used), i.e. straight-line distance to the segment *geometry*, not to its midpoint
and not along the road network. UTM scale error inside one zone is well below 0.1 %.

Time: every row/incident is bucketed by LOCAL clock time of the city (``CITY_META[city].timezone``):
period = calendar month of the local timestamp; time band from the local hour (``TIME_BANDS``; 'night' wraps
midnight and is bucketed with the month of its own calendar date, e.g. 01:30 on 1 March is March/night).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer
from shapely import STRtree

from ..config import CITY_BOUNDING_BOXES, CITY_META
from ..geo import WGS84, utm_crs_for
from .config import SOURCE_PRIORITY, TIME_BANDS, RiskConfig

BANDS = tuple(TIME_BANDS)          # night, early, day, evening (stable order used in the dataset)


def band_for_hour(hour: int) -> str:
    for band, (start, end) in TIME_BANDS.items():
        if (start <= hour < end) if start < end else (hour >= start or hour < end):
            return band
    raise ValueError(f"hour {hour} is not covered by TIME_BANDS")


def city_zone(city_id: str) -> ZoneInfo:
    return ZoneInfo(CITY_META.get(city_id, {}).get("timezone", "Asia/Kolkata"))


def period_label(local_ts: pd.Timestamp) -> str:
    return f"{local_ts.year:04d}-{local_ts.month:02d}"


def period_bounds_utc(period: str, city_id: str) -> tuple[pd.Timestamp, pd.Timestamp]:
    """[start, end) of a calendar month in the city's local time, expressed in UTC."""
    start = pd.Timestamp(f"{period}-01").tz_localize(city_zone(city_id))
    end = (pd.Timestamp(f"{period}-01") + pd.offsets.MonthBegin(1)).tz_localize(city_zone(city_id))
    return start.tz_convert("UTC"), end.tz_convert("UTC")


def months_between(start_utc: pd.Timestamp, end_utc: pd.Timestamp, city_id: str) -> list[str]:
    """Local calendar months overlapping [start, end)."""
    zone = city_zone(city_id)
    first = start_utc.tz_convert(zone)
    last = (end_utc - pd.Timedelta(microseconds=1)).tz_convert(zone)
    return [p.strftime("%Y-%m") for p in pd.period_range(f"{first.year}-{first.month:02d}",
                                                         f"{last.year}-{last.month:02d}", freq="M")]


def crs_for_city(city_id: str):
    box = CITY_BOUNDING_BOXES[city_id]
    return utm_crs_for((box["west"] + box["east"]) / 2, (box["south"] + box["north"]) / 2)


@dataclass
class SegmentIndex:
    """Valid road segments of one city, projected, with a spatial index."""
    city_id: str
    frame: pd.DataFrame            # cleaned segment rows, positional order == geometry order
    geoms: np.ndarray              # projected shapely lines
    bounds_wgs: np.ndarray         # (n, 4) minlon, minlat, maxlon, maxlat
    tree: STRtree
    transformer: Transformer


def build_segment_index(city_id: str, frame: pd.DataFrame) -> SegmentIndex:
    """``frame`` must hold one row per usable segment with a parsed ``_geom`` (WGS84 shapely) column."""
    crs = crs_for_city(city_id)
    transformer = Transformer.from_crs(WGS84, crs, always_xy=True)
    geoms = shapely.transform(np.asarray(frame["_geom"].to_list(), dtype=object),
                              lambda xy: np.column_stack(transformer.transform(xy[:, 0], xy[:, 1])))
    bounds = shapely.bounds(np.asarray(frame["_geom"].to_list(), dtype=object)) if len(frame) else np.empty((0, 4))
    return SegmentIndex(city_id, frame.reset_index(drop=True), geoms, bounds, STRtree(geoms), transformer)


def parse_segment_geometry(wkt: object):
    """WGS84 shapely line from WKT, or None when missing / malformed / non-linear / non-finite."""
    if not isinstance(wkt, str) or not wkt.strip():
        return None
    try:
        geom = shapely.from_wkt(wkt)
    except Exception:
        return None
    if geom is None or geom.is_empty or geom.geom_type not in {"LineString", "MultiLineString"}:
        return None
    coords = shapely.get_coordinates(geom)
    if coords.size == 0 or not np.isfinite(coords).all():
        return None
    if (np.abs(coords[:, 0]) > 180).any() or (np.abs(coords[:, 1]) > 90).any():
        return None
    return geom


def match_points(index: SegmentIndex, lon: np.ndarray, lat: np.ndarray, reach_m: np.ndarray):
    """Segments within ``reach_m[i]`` metres of point i.

    Returns (point_idx, segment_idx, distance_m) sorted by (point, distance, segment_key) for determinism.
    ``reach_m`` entries may differ per point (radius + that incident's location error).
    """
    if not len(lon) or not len(index.frame):
        return np.empty(0, int), np.empty(0, int), np.empty(0)
    x, y = index.transformer.transform(np.asarray(lon, float), np.asarray(lat, float))
    points = shapely.points(x, y)
    pairs = index.tree.query(points, predicate="dwithin", distance=np.asarray(reach_m, float))
    if pairs.shape[1] == 0:
        return np.empty(0, int), np.empty(0, int), np.empty(0)
    point_idx, seg_idx = pairs[0], pairs[1]
    distance = shapely.distance(points[point_idx], index.geoms[seg_idx])
    keys = index.frame["segment_key"].to_numpy()[seg_idx].astype(str)
    order = np.lexsort((keys, distance, point_idx))
    return point_idx[order], seg_idx[order], distance[order]


# ---- duplicates ----------------------------------------------------------------------------------------------

def _priority(row) -> tuple:
    source_rank = SOURCE_PRIORITY.index(row["source"]) if row["source"] in SOURCE_PRIORITY else len(SOURCE_PRIORITY)
    return (0 if row["verification"] == "verified" else 1, source_rank, str(row["incident_id"]))


def mark_duplicates(incidents: pd.DataFrame, config: RiskConfig) -> pd.DataFrame:
    """Add ``duplicate_of`` (``source:incident_id`` of the kept record, or "").

    Two records are the same event when they have the same category and city, lie within
    ``dedupe_distance_m`` and, if both have a time of day, within ``dedupe_window_minutes`` (records with only a
    date are compared with each other on the same local date, never with timed records). Chains (A~B, B~C)
    collapse into one group. The kept record prefers verified > source priority > smallest id. Rejected records
    are not considered. Duplicates only reduce counts; they can never create or remove a label by themselves.
    """
    out = incidents.copy()
    out["duplicate_of"] = ""
    pool = out[out["verification"] != "rejected"]
    if len(pool) < 2:
        return out
    parent = {i: i for i in pool.index}

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    window = pd.Timedelta(minutes=config.dedupe_window_minutes)
    for (city, category, known), group in pool.groupby(["city_id", "category", "time_known"]):
        group = group.sort_values("occurred_at_utc") if known else group.sort_values("occurred_local")
        ids = list(group.index)
        times = (group["occurred_at_utc"].dt.tz_convert("UTC").dt.tz_localize(None).to_numpy() if known
                 else group["occurred_local"].dt.normalize().to_numpy())
        crs = crs_for_city(city)
        tr = Transformer.from_crs(WGS84, crs, always_xy=True)
        x, y = tr.transform(group["lon"].to_numpy(float), group["lat"].to_numpy(float))
        for a in range(len(ids)):
            for b in range(a + 1, len(ids)):
                gap = (times[b] - times[a])
                if known and gap > window.to_timedelta64():
                    break
                if not known and gap > np.timedelta64(0, "ns"):
                    break
                if np.hypot(x[a] - x[b], y[a] - y[b]) <= config.dedupe_distance_m:
                    parent[find(ids[a])] = find(ids[b])
    groups: dict = {}
    for i in pool.index:
        groups.setdefault(find(i), []).append(i)
    for members in groups.values():
        if len(members) < 2:
            continue
        keep = min(members, key=lambda i: _priority(out.loc[i]))
        for i in members:
            if i != keep:
                out.at[i, "duplicate_of"] = f"{out.at[keep, 'source']}:{out.at[keep, 'incident_id']}"
    return out


def assign_time_buckets(incidents: pd.DataFrame) -> pd.DataFrame:
    """Add ``period`` (YYYY-MM, local) and ``band`` ('' when the time of day is unknown)."""
    out = incidents.copy()
    if out.empty:
        out["period"], out["band"] = pd.Series(dtype=str), pd.Series(dtype=str)
        return out
    out["period"] = [period_label(ts) for ts in out["occurred_local"]]
    out["band"] = [band_for_hour(ts.hour) if known else "" for ts, known in zip(out["occurred_local"], out["time_known"])]
    return out


def reach_for(error_m: float, radius_m: float) -> Optional[float]:
    """Distance within which an incident can influence a segment: radius + its stated location error."""
    return None if error_m != error_m else radius_m + max(float(error_m), 0.0)
