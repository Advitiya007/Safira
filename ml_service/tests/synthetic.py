"""SYNTHETIC test fixtures. NOT real geography - never write these to MongoDB.

Builds a grid "city" in GeographicFeature document shape (same geometry types the Node
importer produces: Point nodes, LineString ways incl. closed ways for areas) with a
dense centre and sparse outskirts so that clustering has real structure to find.
"""

from __future__ import annotations

import numpy as np

from safira_ml.config import CITY_BOUNDING_BOXES

SOURCE = "SYNTHETIC-TEST"


def _doc(city, osm_type, osm_id, geometry, tags, categories):
    return {
        "cityId": city, "osmType": osm_type, "osmId": str(osm_id), "geometry": geometry,
        "tags": tags, "featureCategories": categories, "source": SOURCE,
        "dataVersion": "synthetic-1", "importRunId": "synthetic-run",
    }


def make_city_docs(city_id, n_lines=21, spacing=0.0018, seed=0, with_pharmacy=True,
                   rich_scale=1.0):
    rng = np.random.default_rng(seed)
    box = CITY_BOUNDING_BOXES[city_id]
    c_lon = (box["west"] + box["east"]) / 2
    c_lat = (box["south"] + box["north"]) / 2
    half = (n_lines - 1) / 2
    lons = [round(c_lon + (i - half) * spacing, 7) for i in range(n_lines)]
    lats = [round(c_lat + (i - half) * spacing, 7) for i in range(n_lines)]
    docs, osm_id = [], 1000
    for index, lat in enumerate(lats):
        highway = "primary" if index % 5 == 0 else "residential"
        tags = {"highway": highway}
        if highway == "residential" and index % 2:
            tags["sidewalk"] = "both"
        docs.append(_doc(city_id, "way", osm_id,
                         {"type": "LineString", "coordinates": [[lon, lat] for lon in lons]},
                         tags, ["roads"]))
        osm_id += 1
    for index, lon in enumerate(lons):
        highway = "secondary" if index % 5 == 0 else ("footway" if index % 7 == 3 else "residential")
        tags = {"highway": highway}
        if highway == "footway":
            tags["foot"] = "designated"
        docs.append(_doc(city_id, "way", osm_id,
                         {"type": "LineString", "coordinates": [[lon, lat] for lat in lats]},
                         tags, ["roads"]))
        osm_id += 1
    # a highway NODE (importer puts these in 'roads' too) - must not become a segment
    docs.append(_doc(city_id, "node", osm_id, {"type": "Point", "coordinates": [c_lon, c_lat]},
                     {"highway": "traffic_signals"}, ["roads"]))
    osm_id += 1

    extent = half * spacing
    n_pois = 900
    for _ in range(n_pois):
        r = abs(rng.normal(0, extent * 0.35))
        angle = rng.uniform(0, 2 * np.pi)
        lon = c_lon + r * np.cos(angle)
        lat = c_lat + r * np.sin(angle)
        if rng.random() > np.exp(-r / (extent * 0.45)) * rich_scale:
            continue
        geometry = {"type": "Point", "coordinates": [float(lon), float(lat)]}
        kind = rng.random()
        if kind < 0.70:
            tags, cats = {"shop": "convenience"}, ["activity"]
        elif kind < 0.82:
            tags, cats = {"amenity": "restaurant"}, ["activity"]
        elif kind < 0.90:
            tags, cats = {"highway": "bus_stop"}, ["publicTransport"]
        elif kind < 0.94 and with_pharmacy:
            tags, cats = {"amenity": "pharmacy"}, ["activity", "emergency"]
        elif kind < 0.97:
            tags, cats = {"amenity": "clinic"}, ["activity", "emergency"]
        else:
            tags, cats = {"amenity": "police"}, ["emergency"]
        docs.append(_doc(city_id, "node", osm_id, geometry, tags, cats))
        osm_id += 1
    # hospital mapped as a closed way (area) - exercises polygon handling
    d = spacing * 0.3
    ring = [[c_lon + 2 * spacing, c_lat + 2 * spacing], [c_lon + 2 * spacing + d, c_lat + 2 * spacing],
            [c_lon + 2 * spacing + d, c_lat + 2 * spacing + d], [c_lon + 2 * spacing, c_lat + 2 * spacing + d],
            [c_lon + 2 * spacing, c_lat + 2 * spacing]]
    docs.append(_doc(city_id, "way", osm_id, {"type": "LineString", "coordinates": ring},
                     {"amenity": "hospital"}, ["activity", "emergency"]))
    return docs
