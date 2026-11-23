"""Summarise the infrastructure clusters a route passes through.

The route is sampled every ``step_m`` metres; each sample is matched to the nearest stored
road segment within ``tolerance_m``. Samples with no segment nearby are reported as
*unmatched* (never guessed), and segments without an assignment as *unassigned*.
"""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Optional

import numpy as np
import shapely
from shapely.geometry import LineString, mapping
from shapely.strtree import STRtree

from .geo import WGS84, project, to_shapely, utm_crs_for


def _route_line(coords_lonlat) -> LineString:
    line = LineString([(float(x), float(y)) for x, y in coords_lonlat])
    if line.is_empty or line.length == 0:
        raise ValueError("Route geometry has no measurable length")
    return line


def corridor_polygon(coords_lonlat, tolerance_m: float = 30.0) -> dict:
    """GeoJSON polygon (WGS84) covering the route +/- tolerance, for the Mongo geo query."""
    line = _route_line(coords_lonlat)
    crs = utm_crs_for(line.centroid.x, line.centroid.y)
    projected = project([line], crs)[0].simplify(3.0)
    buffered = projected.buffer(tolerance_m, quad_segs=2).simplify(2.0)
    wgs = project([buffered], WGS84, source=crs)[0]
    return mapping(wgs)


def summarise_route(
    coords_lonlat,
    segments: list[dict],
    tolerance_m: float = 30.0,
    step_m: float = 25.0,
) -> dict:
    """``segments``: dicts with GeoJSON ``geometry``, ``clusterId`` (or None), ``clusterName``."""
    line = _route_line(coords_lonlat)
    crs = utm_crs_for(line.centroid.x, line.centroid.y)
    route = project([line], crs)[0]
    length = float(route.length)
    parts = max(1, math.ceil(length / step_m))
    edges = np.linspace(0.0, length, parts + 1)
    weights = np.diff(edges)
    samples = shapely.line_interpolate_point(route, (edges[:-1] + edges[1:]) / 2)

    usable = []
    for segment in segments:
        geom = to_shapely(segment.get("geometry"))
        if geom is not None:
            usable.append((geom, segment))
    per_cluster: dict = defaultdict(float)
    names: dict = {}
    unassigned = 0.0
    matched_any = np.zeros(parts, dtype=bool)
    if usable:
        projected = project([geom for geom, _ in usable], crs)
        tree = STRtree(projected)
        idx, _ = tree.query_nearest(samples, max_distance=tolerance_m, return_distance=True, all_matches=False)
        for sample_index, tree_index in zip(idx[0], idx[1]):
            matched_any[sample_index] = True
            segment = usable[tree_index][1]
            cluster = segment.get("clusterId")
            if cluster is None:
                unassigned += float(weights[sample_index])
            else:
                per_cluster[int(cluster)] += float(weights[sample_index])
                names[int(cluster)] = segment.get("clusterName")
    assigned = float(sum(per_cluster.values()))
    unmatched = float(weights[~matched_any].sum())
    shares = [
        {
            "clusterId": cluster,
            "name": names.get(cluster),
            "lengthMeters": round(meters, 1),
            "percentOfRoute": round(100 * meters / length, 1),
            "percentOfMatched": round(100 * meters / assigned, 1) if assigned else 0.0,
        }
        for cluster, meters in sorted(per_cluster.items(), key=lambda item: -item[1])
    ]
    return {
        "routeLengthMeters": round(length, 1),
        "assignedLengthMeters": round(assigned, 1),
        "unassignedLengthMeters": round(unassigned, 1),
        "unmatchedLengthMeters": round(unmatched, 1),
        "assignedCoveragePercent": round(100 * assigned / length, 1),
        "dominantCluster": ({"clusterId": shares[0]["clusterId"], "name": shares[0]["name"]}
                            if shares else None),
        "clusterShares": shares,
        "matching": {"toleranceMeters": tolerance_m, "sampleStepMeters": step_m},
    }
