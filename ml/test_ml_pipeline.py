"""
Unit Tests for Machine Learning Subsystem
Verifies spatial utilities, segmentation, feature transformation,
and model inference on saved artifacts.
"""

import unittest
import numpy as np
import pandas as pd
import joblib
from pathlib import Path

from ml.config import (
    MODELS_DIR,
    NUMERICAL_FEATURES,
    MAX_FACILITY_DISTANCE_METERS,
)
from ml.feature_engineering import (
    compute_haversine_meters,
    project_coordinates_to_metric,
    compute_road_accessibility,
    segment_road_geometry,
    normalize_highway_type,
)
from ml.train_clustering import COUNT_FEATURES, DISTANCE_FEATURES

class TestMLPipeline(unittest.TestCase):
    
    def test_haversine_distance(self):
        # Known distance between New Delhi Railway Station and Connaught Place (~1.2 km)
        p1 = [77.2197, 28.6430]
        p2 = [77.2167, 28.6328]
        dist = compute_haversine_meters(p1[0], p1[1], p2[0], p2[1])
        self.assertGreater(dist, 800)
        self.assertLess(dist, 1600)
        
    def test_coordinate_metric_projection(self):
        lons = np.array([77.2, 77.21])
        lats = np.array([28.6, 28.61])
        x, y = project_coordinates_to_metric(lons, lats, ref_lat=28.6)
        self.assertEqual(len(x), 2)
        self.assertEqual(len(y), 2)
        # Delta should be roughly 1000m
        self.assertGreater(x[1] - x[0], 800)
        self.assertGreater(y[1] - y[0], 900)

    def test_road_accessibility_scoring(self):
        footway_score = compute_road_accessibility("footway", "yes", "no")
        motorway_score = compute_road_accessibility("motorway", "no", "yes")
        no_foot_score = compute_road_accessibility("residential", "no", "yes")
        
        self.assertGreater(footway_score, 80)
        self.assertLess(motorway_score, 30)
        self.assertEqual(no_foot_score, 0.0)

    def test_road_segmentation(self):
        # LineString with ~450m length
        line = [
            [77.2000, 28.6000],
            [77.2015, 28.6015],
            [77.2030, 28.6030]
        ]
        segments = segment_road_geometry(line, target_length_m=150.0)
        self.assertGreaterEqual(len(segments), 2)
        for seg in segments:
            self.assertIn("start", seg)
            self.assertIn("end", seg)
            self.assertIn("midpoint", seg)
            self.assertGreater(seg["length_m"], 0)

    def test_model_artifacts_and_prediction(self):
        model_path = MODELS_DIR / "kmeans_infrastructure.joblib"
        scaler_path = MODELS_DIR / "scaler.joblib"
        self.assertTrue(model_path.exists(), "K-Means model artifact not found")
        self.assertTrue(scaler_path.exists(), "Scaler artifact not found")
        
        kmeans = joblib.load(model_path)
        scaler = joblib.load(scaler_path)
        
        # Test sample observation
        sample_obs = {
            "road_length_m": 150.0,
            "police_count_1km": 2.0,
            "nearest_police_dist_m": 450.0,
            "hospital_count_1km": 5.0,
            "nearest_hospital_dist_m": 300.0,
            "pharmacy_count_500m": 3.0,
            "nearest_pharmacy_dist_m": 200.0,
            "shop_count_250m": 12.0,
            "establishment_density_sqkm": 61.1,
            "transit_count_500m": 4.0,
            "nearest_transit_dist_m": 150.0,
            "lighting_signals_count": 2.0,
            "road_accessibility_score": 85.0,
        }
        
        df_test = pd.DataFrame([sample_obs])
        X_df = df_test[NUMERICAL_FEATURES].copy()
        for col in COUNT_FEATURES:
            X_df[col] = np.log1p(X_df[col])
        for col in DISTANCE_FEATURES:
            X_df[col] = X_df[col] / MAX_FACILITY_DISTANCE_METERS
            
        X_scaled = scaler.transform(X_df.values)
        predicted_cluster = kmeans.predict(X_scaled)[0]
        
        self.assertIn(predicted_cluster, [0, 1, 2, 3])
        print(f"\n[TEST INFERENCE] Sample road segment successfully predicted into Cluster: {predicted_cluster}")

if __name__ == "__main__":
    unittest.main()
