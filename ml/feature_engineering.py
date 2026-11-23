"""
Feature Engineering Module
Processes road ways into discrete segments and computes infrastructure metrics
using spatial indexing (cKDTree) against POI datasets.
"""

import json
import math
import numpy as np
import pandas as pd
from typing import Dict, List, Tuple
from scipy.spatial import cKDTree

from ml.config import (
    SPATIAL_RADII,
    TARGET_SEGMENT_LENGTH_METERS,
    MAX_FACILITY_DISTANCE_METERS,
    DATA_DIR,
    SUPPORTED_CITIES,
)

# Activity amenities set (matching SafeRouteConfig logic)
ACTIVITY_AMENITIES = {
    'restaurant', 'cafe', 'fast_food', 'pub', 'bar', 'food_court',
    'marketplace', 'pharmacy', 'fuel', 'bank', 'atm'
}

def project_coordinates_to_metric(lons: np.ndarray, lats: np.ndarray, ref_lat: float) -> Tuple[np.ndarray, np.ndarray]:
    """
    Projects WGS84 (lon, lat) to local Cartesian metric coordinates (x, y) in meters.
    Accurate for regional city-scale extents.
    """
    scale_y = 110540.0
    scale_x = 111320.0 * math.cos(math.radians(ref_lat))
    x = lons * scale_x
    y = lats * scale_y
    return x, y

def compute_haversine_meters(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Computes great-circle distance between two points in meters."""
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def compute_road_accessibility(highway: str, foot: str, vehicle: str) -> float:
    """
    Calculates road accessibility score [0 - 100] based on OSM tags.
    Reflects pedestrian / solo-travel infrastructure suitability.
    """
    if foot in ['no', 'private']:
        return 0.0
    
    highway_scores = {
        'footway': 95.0,
        'pedestrian': 95.0,
        'path': 85.0,
        'steps': 80.0,
        'living_street': 90.0,
        'residential': 80.0,
        'service': 70.0,
        'tertiary': 75.0,
        'secondary': 65.0,
        'primary': 50.0,
        'unclassified': 60.0,
        'track': 45.0,
        'trunk': 20.0,
        'motorway': 10.0,
    }
    score = highway_scores.get(str(highway).lower(), 55.0)
    
    if foot == 'yes':
        score = min(100.0, score + 10.0)
    if vehicle in ['no', 'private'] and score > 20:
        score = min(100.0, score + 5.0)  # Pedestrian priority
    return float(score)

def normalize_highway_type(highway: str) -> str:
    """Standardizes highway tag into common categorical bins."""
    h = str(highway).lower().strip()
    standard_types = [
        'primary', 'secondary', 'tertiary', 'residential',
        'service', 'footway', 'pedestrian', 'path', 'track',
        'trunk', 'motorway', 'living_street', 'unclassified'
    ]
    return h if h in standard_types else 'other'

def segment_road_geometry(coordinates: List[List[float]], target_length_m: float = 150.0) -> List[Dict]:
    """
    Breaks a multi-point road line into segments of approximately target_length_m.
    Returns segment dictionaries with start, end, midpoint, and length.
    """
    if not coordinates or len(coordinates) < 2:
        return []
    
    # Calculate cumulative distance
    points = coordinates
    n = len(points)
    total_dist = 0.0
    for i in range(n - 1):
        total_dist += compute_haversine_meters(points[i][0], points[i][1], points[i+1][0], points[i+1][1])
        
    if total_dist <= 0:
        return []
        
    # If shorter than 1.5 * target_length, return as single segment
    if total_dist <= target_length_m * 1.5:
        mid_idx = n // 2
        midpoint = points[mid_idx]
        return [{
            "start": points[0],
            "end": points[-1],
            "midpoint": midpoint,
            "length_m": float(round(total_dist, 1))
        }]
        
    # Divide into roughly equal sub-segments
    num_segments = max(2, int(round(total_dist / target_length_m)))
    seg_step = total_dist / num_segments
    
    segments = []
    current_dist = 0.0
    target_next = seg_step
    seg_start = points[0]
    
    for i in range(n - 1):
        p1 = points[i]
        p2 = points[i+1]
        step_len = compute_haversine_meters(p1[0], p1[1], p2[0], p2[1])
        
        while current_dist + step_len >= target_next and len(segments) < num_segments - 1:
            ratio = (target_next - current_dist) / max(step_len, 1e-6)
            mid_lon = p1[0] + ratio * (p2[0] - p1[0])
            mid_lat = p1[1] + ratio * (p2[1] - p1[1])
            seg_end = [mid_lon, mid_lat]
            
            calc_mid = [
                (seg_start[0] + seg_end[0]) / 2.0,
                (seg_start[1] + seg_end[1]) / 2.0
            ]
            segments.append({
                "start": seg_start,
                "end": seg_end,
                "midpoint": calc_mid,
                "length_m": float(round(seg_step, 1))
            })
            seg_start = seg_end
            target_next += seg_step
            
        current_dist += step_len
        
    # Final trailing segment
    calc_mid = [
        (seg_start[0] + points[-1][0]) / 2.0,
        (seg_start[1] + points[-1][1]) / 2.0
    ]
    last_len = compute_haversine_meters(seg_start[0], seg_start[1], points[-1][0], points[-1][1])
    segments.append({
        "start": seg_start,
        "end": points[-1],
        "midpoint": calc_mid,
        "length_m": float(round(max(last_len, 10.0), 1))
    })
    
    return segments

class CitySpatialIndex:
    """Builds KD-trees for each POI category in a city for rapid distance & count queries."""
    def __init__(self, df_pois: pd.DataFrame, ref_lat: float):
        self.ref_lat = ref_lat
        self.trees: Dict[str, cKDTree] = {}
        self.counts: Dict[str, int] = {}
        
        if df_pois.empty:
            return
            
        # Classify POIs into distinct indicator categories
        lons = df_pois["lon"].values
        lats = df_pois["lat"].values
        x, y = project_coordinates_to_metric(lons, lats, ref_lat)
        coords = np.column_stack((x, y))
        
        amenity = df_pois["amenity"].fillna("").values
        shop = df_pois["shop"].fillna("").values
        highway = df_pois["highway"].fillna("").values
        public_transport = df_pois["public_transport"].fillna("").values
        railway = df_pois["railway"].fillna("").values
        man_made = df_pois["man_made"].fillna("").values
        lit = df_pois["lit"].fillna("").values
        
        # 1. Police
        is_police = (amenity == "police")
        self._build_tree("police", coords[is_police])
        
        # 2. Hospitals & clinics
        is_hospital = np.isin(amenity, ["hospital", "clinic"])
        self._build_tree("hospital", coords[is_hospital])
        
        # 3. Pharmacies
        is_pharmacy = (amenity == "pharmacy")
        self._build_tree("pharmacy", coords[is_pharmacy])
        
        # 4. Commercial activity & shops
        is_shop = (shop != "") & (shop != "no")
        is_activity_amenity = np.isin(amenity, list(ACTIVITY_AMENITIES))
        is_activity = is_shop | is_activity_amenity
        self._build_tree("shop", coords[is_activity])
        
        # 5. Public transport
        is_transit = (
            np.isin(highway, ["bus_stop"]) |
            (public_transport != "") |
            np.isin(railway, ["station", "halt"]) |
            (amenity == "bus_station")
        )
        self._build_tree("transit", coords[is_transit])
        
        # 6. Lighting
        is_lighting = (highway == "street_lamp") | np.isin(lit, ["yes", "limited"])
        self._build_tree("lighting", coords[is_lighting])
        
        # 7. CCTV Surveillance
        is_cctv = (man_made == "surveillance")
        self._build_tree("cctv", coords[is_cctv])

    def _build_tree(self, name: str, subset_coords: np.ndarray):
        if len(subset_coords) > 0:
            self.trees[name] = cKDTree(subset_coords)
            self.counts[name] = len(subset_coords)
        else:
            self.trees[name] = None
            self.counts[name] = 0

    def query_metrics(self, x: float, y: float) -> Dict[str, float]:
        """Queries counts within radii and nearest distances for a metric point."""
        query_pt = np.array([x, y])
        metrics = {}
        
        for name, radius in SPATIAL_RADII.items():
            tree = self.trees.get(name)
            if tree is not None:
                # Count within radius
                count = len(tree.query_ball_point(query_pt, r=radius))
                # Distance to nearest
                dist, _ = tree.query(query_pt, k=1)
                dist = min(float(dist), MAX_FACILITY_DISTANCE_METERS)
            else:
                count = 0
                dist = MAX_FACILITY_DISTANCE_METERS
                
            metrics[f"{name}_count"] = int(count)
            metrics[f"nearest_{name}_dist"] = float(round(dist, 1))
            
        return metrics

def build_city_features(city_id: str) -> pd.DataFrame:
    """
    Segments all road ways in the city and computes infrastructure indicators.
    Returns a pandas DataFrame of road segment observations.
    """
    road_file = DATA_DIR / f"roads_{city_id}.parquet"
    poi_file = DATA_DIR / f"pois_{city_id}.parquet"
    
    if not road_file.exists() or not poi_file.exists():
        raise FileNotFoundError(f"Missing parquet data files for city {city_id} in {DATA_DIR}")
        
    df_roads = pd.read_parquet(road_file)
    df_pois = pd.read_parquet(poi_file)
    
    if df_roads.empty:
        return pd.DataFrame()
        
    ref_lat = float(df_pois["lat"].mean()) if not df_pois.empty else 28.6
    spatial_index = CitySpatialIndex(df_pois, ref_lat)
    
    print(f"[{city_id.upper()}] Engineering features for {len(df_roads)} road ways...")
    
    records = []
    total_segments = 0
    
    for _, row in df_roads.iterrows():
        osm_id = row["osm_id"]
        highway = row["highway"]
        highway_norm = normalize_highway_type(highway)
        lit = row["lit"]
        foot = row["foot"]
        vehicle = row["vehicle"]
        access_score = compute_road_accessibility(highway, foot, vehicle)
        
        try:
            coords = json.loads(row["coordinates_json"])
        except Exception:
            continue
            
        segments = segment_road_geometry(coords, target_length_m=TARGET_SEGMENT_LENGTH_METERS)
        
        for seg_idx, seg in enumerate(segments):
            total_segments += 1
            mid_lon, mid_lat = seg["midpoint"]
            x, y = project_coordinates_to_metric(np.array([mid_lon]), np.array([mid_lat]), ref_lat)
            spatial_metrics = spatial_index.query_metrics(x[0], y[0])
            
            shop_count = spatial_metrics["shop_count"]
            # Density per sq km: area of 250m circle = pi * (0.25)^2 = 0.1963 sq km
            est_density = round(shop_count / 0.1963, 1)
            
            rec = {
                "segment_id": f"{city_id}_{osm_id}_{seg_idx}",
                "city_id": city_id,
                "osm_id": osm_id,
                "highway_type": highway_norm,
                "road_length_m": seg["length_m"],
                "midpoint_lon": mid_lon,
                "midpoint_lat": mid_lat,
                "police_count_1km": spatial_metrics["police_count"],
                "nearest_police_dist_m": spatial_metrics["nearest_police_dist"],
                "hospital_count_1km": spatial_metrics["hospital_count"],
                "nearest_hospital_dist_m": spatial_metrics["nearest_hospital_dist"],
                "pharmacy_count_500m": spatial_metrics["pharmacy_count"],
                "nearest_pharmacy_dist_m": spatial_metrics["nearest_pharmacy_dist"],
                "shop_count_250m": shop_count,
                "establishment_density_sqkm": est_density,
                "transit_count_500m": spatial_metrics["transit_count"],
                "nearest_transit_dist_m": spatial_metrics["nearest_transit_dist"],
                "lighting_signals_count": spatial_metrics["lighting_count"],
                "cctv_count_250m": spatial_metrics["cctv_count"],
                "road_accessibility_score": access_score,
            }
            records.append(rec)
            
    df_features = pd.DataFrame(records)
    print(f"[{city_id.upper()}] Generated {len(df_features)} road segment observations.")
    return df_features

def generate_all_features(cities=None) -> pd.DataFrame:
    """Generates and combines features across all cities, saving to combined parquet."""
    cities = cities or SUPPORTED_CITIES
    dfs = []
    for city_id in cities:
        df_city = build_city_features(city_id)
        if not df_city.empty:
            out_city = DATA_DIR / f"features_{city_id}.parquet"
            df_city.to_parquet(out_city, index=False)
            print(f"Saved {len(df_city)} features for {city_id} to {out_city}")
            dfs.append(df_city)
            
    if not dfs:
        raise ValueError("No feature data was generated for any city.")
        
    df_all = pd.concat(dfs, ignore_index=True)
    out_all = DATA_DIR / "features_combined.parquet"
    df_all.to_parquet(out_all, index=False)
    print(f"\nSuccessfully combined {len(df_all)} observations saved to {out_all}")
    return df_all

if __name__ == "__main__":
    generate_all_features()
