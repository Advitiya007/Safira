"""Per-segment infrastructure features (all distances in a projected CRS, metres).

Missing vs zero
---------------
* If a city has NO imported records of a class (e.g. no pharmacies at all) the count and
  nearest-distance for that class are NaN: the information is unknown, not zero.
* If the class exists in the city but none lies within the radius, the count is a genuine
  0 and the real nearest distance is still reported.
* Accessibility values come only from explicit OSM tags and are NaN when untagged.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

from .config import ExtractionParams

POI_CLASSES = ("police", "hospital", "pharmacy", "shop", "transport", "establishment")


@dataclass
class PoiLayer:
    geoms: np.ndarray
    tree: Optional[STRtree]

    @classmethod
    def from_geoms(cls, geoms) -> "PoiLayer":
        arr = np.asarray(list(geoms), dtype=object)
        return cls(arr, STRtree(arr) if len(arr) else None)

    def __len__(self) -> int:
        return len(self.geoms)


def class_radius(name: str, params: ExtractionParams) -> float:
    return params.emergency_radius_m if name in {"police", "hospital", "pharmacy"} else params.activity_radius_m


def count_within(layer: PoiLayer, targets: np.ndarray, radius: float) -> np.ndarray:
    if layer.tree is None:
        return np.full(len(targets), np.nan)
    pairs = layer.tree.query(targets, predicate="dwithin", distance=radius)
    return np.bincount(pairs[0], minlength=len(targets)).astype(float)


def nearest_distance(layer: PoiLayer, targets: np.ndarray) -> np.ndarray:
    out = np.full(len(targets), np.nan)
    if layer.tree is None:
        return out
    idx, dist = layer.tree.query_nearest(targets, return_distance=True, all_matches=False)
    out[idx[0]] = dist
    return out


def compute_features(
    segments: gpd.GeoDataFrame,
    layers: dict[str, PoiLayer],
    bbox_polygon: Optional[BaseGeometry],
    params: ExtractionParams,
) -> pd.DataFrame:
    """Return a DataFrame (same index as ``segments``) of the infrastructure features."""
    targets = segments.geometry.to_numpy()
    out = pd.DataFrame(index=segments.index)
    for name in ("police", "hospital", "pharmacy"):
        layer = layers[name]
        out[f"{name}_count"] = count_within(layer, targets, class_radius(name, params))
        out[f"{name}_nearest_m"] = nearest_distance(layer, targets)
    out["shop_count"] = count_within(layers["shop"], targets, params.activity_radius_m)
    out["transport_count"] = count_within(layers["transport"], targets, params.activity_radius_m)
    out["establishment_count"] = count_within(layers["establishment"], targets, params.activity_radius_m)

    buffer_km2 = shapely.area(shapely.buffer(targets, params.activity_radius_m)) / 1e6
    out["establishment_density_per_km2"] = out["establishment_count"] / buffer_km2

    if bbox_polygon is not None:
        out["bbox_edge_distance_m"] = shapely.distance(targets, bbox_polygon.boundary)
    else:
        out["bbox_edge_distance_m"] = np.nan
    out["near_bbox_edge"] = out["bbox_edge_distance_m"] < params.emergency_radius_m
    return out
