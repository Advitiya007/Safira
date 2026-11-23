"""Split OSM road ways into segments.

1. Find junction vertices: coordinates shared by two or more distinct road ways
   (the stored geometry has no node IDs, but Overpass returns exact 7-decimal
   coordinates, so shared OSM nodes match exactly). Way endpoints are boundaries too.
2. Split each way at its junction vertices.
3. Split any resulting piece longer than ``max_segment_m`` into equal parts
   (lengths are measured in a projected CRS).

A way that crosses another without a shared node (bridge/tunnel) is correctly *not*
treated as an intersection.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable

import geopandas as gpd
import numpy as np
from pyproj import CRS
from shapely.geometry import LineString
from shapely.ops import substring

from . import tags as T
from .config import HIGHWAY_TO_GROUP, ExtractionParams
from .geo import WGS84, project


@dataclass
class RoadWay:
    osm_id: str
    highway: str
    coords: list  # [(lon, lat), ...]
    tags: dict = field(default_factory=dict)


def _key(coord, precision: int):
    return (round(coord[0], precision), round(coord[1], precision))


def find_junctions(ways: Iterable[RoadWay], precision: int) -> set:
    counts: dict = {}
    for way in ways:
        for key in {_key(c, precision) for c in way.coords}:
            counts[key] = counts.get(key, 0) + 1
    return {key for key, count in counts.items() if count >= 2}


def split_at_junctions(coords: list, junctions: set, precision: int) -> list[list]:
    pieces: list[list] = []
    start = 0
    for index in range(1, len(coords) - 1):
        if _key(coords[index], precision) in junctions:
            pieces.append(coords[start:index + 1])
            start = index
    pieces.append(coords[start:])
    cleaned = []
    for piece in pieces:
        deduped = [piece[0]]
        for coord in piece[1:]:
            if coord != deduped[-1]:
                deduped.append(coord)
        if len(deduped) >= 2:
            cleaned.append(deduped)
    return cleaned


def _subdivide(line: LineString, max_length: float) -> list[LineString]:
    length = line.length
    parts = max(1, math.ceil(length / max_length))
    if parts == 1:
        return [line]
    step = length / parts
    out = []
    for index in range(parts):
        piece = substring(line, index * step, (index + 1) * step)
        if isinstance(piece, LineString) and piece.length > 0:
            out.append(piece)
    return out


def build_segments(
    ways: list[RoadWay], crs: CRS, params: ExtractionParams
) -> gpd.GeoDataFrame:
    """Return segments in the projected ``crs`` with road attributes."""
    junctions = find_junctions(ways, params.junction_precision)
    records = []
    lines_wgs = []
    for way in ways:
        group = HIGHWAY_TO_GROUP[way.highway]
        pieces = split_at_junctions(way.coords, junctions, params.junction_precision)
        for piece_index, piece in enumerate(pieces):
            lines_wgs.append(LineString(piece))
            records.append((way, group, piece_index))
    if not records:
        return gpd.GeoDataFrame(
            {"segment_key": [], "way_osm_id": [], "highway": [], "road_group": []},
            geometry=[], crs=crs,
        )
    projected = project(lines_wgs, crs)

    rows = []
    geoms = []
    for (way, group, piece_index), line in zip(records, projected):
        if line.length <= 0:
            continue
        for sub_index, part in enumerate(_subdivide(line, params.max_segment_m)):
            tags = way.tags
            rows.append({
                "segment_key": f"{way.osm_id}:{piece_index}:{sub_index}",
                "way_osm_id": way.osm_id,
                "highway": way.highway,
                "road_group": group,
                "length_m": part.length,
                "foot_access": T.foot_access(tags),
                "vehicle_access": T.vehicle_access(tags),
                "sidewalk_present": T.sidewalk_present(tags),
                "lit_tag": T.lit_tag(tags),
            })
            geoms.append(part)
    frame = gpd.GeoDataFrame(rows, geometry=geoms, crs=crs)
    frame["is_short"] = frame["length_m"] < params.min_segment_m
    return frame


def to_wgs84(segments: gpd.GeoDataFrame) -> gpd.GeoSeries:
    return segments.geometry.to_crs(WGS84)
