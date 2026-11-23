"""
Data Extraction Module
Extracts road geometries and POI features from MongoDB Atlas for specified cities.
Saves local snapshots to ml/data/ for high-performance offline feature engineering.
"""

import sys
import json
import gzip
import argparse
import numpy as np
import pandas as pd
from pymongo import MongoClient
from pathlib import Path

from ml.config import (
    MONGO_URI,
    SUPPORTED_CITIES,
    DATA_DIR,
)

def get_db_client():
    """Initializes and returns a MongoDB client and database reference."""
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=10000)
    db = client.get_default_database()
    return client, db

def extract_city_pois(db, city_id: str) -> pd.DataFrame:
    """Extracts all emergency, activity, transit, lighting, and surveillance POIs for a city."""
    print(f"[{city_id.upper()}] Querying POI records from geographicfeatures...")
    poi_query = {
        "cityId": city_id,
        "featureCategories": {
            "$in": ["emergency", "activity", "publicTransport", "lighting", "surveillance"]
        }
    }
    projection = {
        "osmId": 1,
        "osmType": 1,
        "cityId": 1,
        "featureCategories": 1,
        "geometry": 1,
        "tags": 1
    }
    
    cursor = db.geographicfeatures.find(poi_query, projection)
    pois = []
    for doc in cursor:
        geom = doc.get("geometry", {})
        gtype = geom.get("type")
        coords = geom.get("coordinates")
        tags = doc.get("tags", {})
        categories = doc.get("featureCategories", [])
        
        # Calculate reference point (longitude, latitude)
        point = None
        if gtype == "Point" and coords and len(coords) >= 2:
            point = (coords[0], coords[1])
        elif gtype in ["LineString", "Polygon"] and coords:
            flat_coords = coords[0] if gtype == "Polygon" else coords
            if flat_coords and len(flat_coords) > 0:
                lons = [c[0] for c in flat_coords if len(c) >= 2]
                lats = [c[1] for c in flat_coords if len(c) >= 2]
                if lons and lats:
                    point = (float(np.mean(lons)), float(np.mean(lats)))
        
        if point:
            pois.append({
                "osm_id": str(doc.get("osmId")),
                "city_id": city_id,
                "lon": point[0],
                "lat": point[1],
                "amenity": tags.get("amenity", ""),
                "shop": tags.get("shop", ""),
                "highway": tags.get("highway", ""),
                "public_transport": tags.get("public_transport", ""),
                "railway": tags.get("railway", ""),
                "man_made": tags.get("man_made", ""),
                "lit": tags.get("lit", ""),
                "categories": json.dumps(categories),
            })
            
    df_pois = pd.DataFrame(pois)
    print(f"[{city_id.upper()}] Extracted {len(df_pois)} POIs.")
    return df_pois

def extract_city_roads(db, city_id: str, limit: int = None) -> pd.DataFrame:
    """Extracts road lines (LineString/MultiLineString) for a city."""
    print(f"[{city_id.upper()}] Querying road records from geographicfeatures...")
    road_query = {
        "cityId": city_id,
        "featureCategories": "roads",
        "geometry.type": {"$in": ["LineString", "MultiLineString"]}
    }
    projection = {
        "osmId": 1,
        "osmType": 1,
        "cityId": 1,
        "geometry": 1,
        "tags": 1
    }
    
    cursor = db.geographicfeatures.find(road_query, projection)
    if limit and limit > 0:
        cursor = cursor.limit(limit)
        
    roads = []
    count = 0
    for doc in cursor:
        count += 1
        geom = doc.get("geometry", {})
        tags = doc.get("tags", {})
        highway = tags.get("highway", "unclassified")
        
        roads.append({
            "osm_id": str(doc.get("osmId")),
            "city_id": city_id,
            "highway": str(highway),
            "lit": str(tags.get("lit", "unknown")),
            "foot": str(tags.get("foot", "unknown")),
            "vehicle": str(tags.get("vehicle", tags.get("motor_vehicle", "unknown"))),
            "maxspeed": str(tags.get("maxspeed", "")),
            "oneway": str(tags.get("oneway", "no")),
            "coordinates_json": json.dumps(geom.get("coordinates", [])),
            "geom_type": geom.get("type", "LineString"),
        })
        if count % 10000 == 0:
            print(f"[{city_id.upper()}] Processed {count} road ways...")
            
    df_roads = pd.DataFrame(roads)
    print(f"[{city_id.upper()}] Extracted {len(df_roads)} road ways.")
    return df_roads

def run_extraction(cities=None, road_limit=None):
    """Executes extraction across specified cities and saves to DATA_DIR."""
    cities = cities or SUPPORTED_CITIES
    client, db = get_db_client()
    
    for city_id in cities:
        print(f"\n==================== EXTRACTING {city_id.upper()} ====================")
        poi_file = DATA_DIR / f"pois_{city_id}.parquet"
        road_file = DATA_DIR / f"roads_{city_id}.parquet"
        
        # Extract and save POIs
        df_pois = extract_city_pois(db, city_id)
        df_pois.to_parquet(poi_file, index=False)
        print(f"Saved {len(df_pois)} POIs to {poi_file}")
        
        # Extract and save Roads
        df_roads = extract_city_roads(db, city_id, limit=road_limit)
        df_roads.to_parquet(road_file, index=False)
        print(f"Saved {len(df_roads)} roads to {road_file}")
        
    client.close()
    print("\nExtraction complete across all requested cities.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract road and POI data from MongoDB Atlas.")
    parser.add_argument("--cities", nargs="+", default=SUPPORTED_CITIES, help="List of cities to extract")
    parser.add_argument("--road-limit", type=int, default=None, help="Max roads to extract per city (None for all)")
    args = parser.parse_args()
    
    run_extraction(cities=args.cities, road_limit=args.road_limit)
