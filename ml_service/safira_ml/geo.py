"""Geometry helpers: GeoJSON -> shapely, areas, projections."""

from __future__ import annotations

import math
from typing import Optional

import numpy as np
import shapely
from pyproj import CRS
from shapely.geometry import LineString, MultiLineString, Polygon, shape
from shapely.geometry.base import BaseGeometry

WGS84 = CRS.from_epsg(4326)


def to_shapely(geometry: Optional[dict]) -> Optional[BaseGeometry]:
    """Parse GeoJSON; return None for malformed, empty or non-finite geometry."""
    if not isinstance(geometry, dict):
        return None
    try:
        geom = shape(geometry)
    except Exception:
        return None
    if geom.is_empty:
        return None
    coords = shapely.get_coordinates(geom)
    if coords.size == 0 or not np.isfinite(coords).all():
        return None
    if (np.abs(coords[:, 0]) > 180).any() or (np.abs(coords[:, 1]) > 90).any():
        return None
    return geom


def poi_geometry(geom: BaseGeometry) -> BaseGeometry:
    """Return the geometry to use for a point-of-interest.

    The importer stores area POIs (building outlines mapped as closed ways) as closed
    ``LineString`` values, never ``Polygon``. A closed ring is therefore promoted to a
    polygon so distances/containment treat it as an area. Real Polygon/MultiPolygon,
    Point, open lines and MultiLineString are used as they are.
    """
    if isinstance(geom, LineString) and len(geom.coords) >= 4 and geom.is_closed:
        polygon = Polygon(geom.coords)
        if not polygon.is_valid:
            polygon = shapely.make_valid(polygon)
        if polygon.geom_type in {"Polygon", "MultiPolygon"} and not polygon.is_empty:
            return polygon
    return geom


def utm_crs_for(lon: float, lat: float) -> CRS:
    zone = int(math.floor((lon + 180.0) / 6.0)) + 1
    zone = min(max(zone, 1), 60)
    return CRS.from_epsg((32600 if lat >= 0 else 32700) + zone)


def project(geoms, crs: CRS, source: CRS = WGS84):
    """Project an array of shapely geometries (vectorised)."""
    from pyproj import Transformer

    transformer = Transformer.from_crs(source, crs, always_xy=True)
    return shapely.transform(
        np.asarray(geoms, dtype=object),
        lambda xy: np.column_stack(transformer.transform(xy[:, 0], xy[:, 1])),
    )


def line_parts(geom: BaseGeometry) -> list[LineString]:
    if isinstance(geom, LineString):
        return [geom]
    if isinstance(geom, MultiLineString):
        return list(geom.geoms)
    return []
