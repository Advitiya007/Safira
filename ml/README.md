# Safira Machine Learning Subsystem — Infrastructure Profiling

This subsystem implements unsupervised machine learning using K-Means clustering to discover geographical infrastructure patterns across road networks in Indian cities using OpenStreetMap data.

> **Important**: This model discovers and profiles physical infrastructure availability (commercial density, public transit, emergency service proximity, road accessibility). It is **not** a crime prediction model and does not claim any route or road is objectively safe.

---

## 1. Directory Structure

```bash
ml/
├── config.py                 # Configuration, search radii, feature lists, and hyperparameters
├── extract_data.py           # Extracts roads and POIs from MongoDB Atlas into Parquet
├── feature_engineering.py    # Decomposes roads into ~150m segments and builds cKDTree spatial indices
├── train_clustering.py       # Preprocessing, log1p scaling, Elbow/Silhouette analysis, K-Means training, PCA
├── evaluate.py               # Cross-city comparison, generalization analysis, and markdown report generation
├── test_ml_pipeline.py       # Unit test suite for spatial calculations and model inference
├── data/                     # Local Parquet datasets (roads, pois, features_combined, features_with_clusters)
├── models/                   # Serialized model artifacts (kmeans_infrastructure.joblib, scaler.joblib, etc.)
└── reports/
    ├── figures/              # Generated visualizations (elbow, silhouette, PCA, cluster signatures)
    └── infrastructure_clustering_report.md  # Detailed analytical report
```

---

## 2. Feature Definitions

Each observation represents a ~150 m road segment:

1. `road_length_m`: Physical length in meters (geodesic distance).
2. `police_count_1km`: Police stations within 1,000 m.
3. `nearest_police_dist_m`: Distance to nearest police station (capped at 2,500 m).
4. `hospital_count_1km`: Hospitals/clinics within 1,000 m.
5. `nearest_hospital_dist_m`: Distance to nearest hospital/clinic (capped at 2,500 m).
6. `pharmacy_count_500m`: Pharmacies within 500 m.
7. `nearest_pharmacy_dist_m`: Distance to nearest pharmacy (capped at 2,500 m).
8. `shop_count_250m`: Commercial establishments (shops, cafes, eateries, marketplaces) within 250 m.
9. `establishment_density_sqkm`: Commercial establishments per $\text{km}^2$.
10. `transit_count_500m`: Public transit stops (bus/metro/train) within 500 m.
11. `nearest_transit_dist_m`: Distance to nearest public transit stop (capped at 2,500 m).
12. `lighting_signals_count`: Street lamps or mapped lit road attributes within 100 m.
13. `road_accessibility_score`: Pedestrian/vehicular accessibility score [0-100] based on OSM tags.

---

## 3. Discovered Infrastructure Archetypes ($k = 4$)

- **Cluster 0 — Peripheral / Isolated Low-Density Road (36.8%)**:
  Semi-rural, peripheral, or connector roads with low commercial presence and higher distances to emergency services.
- **Cluster 1 — Active Residential & Local Connector (34.1%)**:
  Neighborhood roads and residential streets with good pedestrian accessibility, calm traffic, and regular transit stops.
- **Cluster 2 — Civic & Emergency-Proximate Urban Corridor (22.6%)**:
  Roads with close proximity to hospitals, clinics, and police stations with moderate commercial presence.
- **Cluster 3 — High-Density Commercial & Transit Hub (6.5%)**:
  High-activity urban corridors with dense commercial establishments, frequent transit connections, and high pedestrian footfall.

---

## 4. Running the Pipeline

```bash
# 1. Extract raw data from MongoDB Atlas (requires network)
python -m ml.extract_data --road-limit 25000

# 2. Run feature engineering (spatial segmentation and cKDTree indexing)
python -m ml.feature_engineering

# 3. Train K-Means model (evaluates k in [2, 8] and trains optimal model)
python -m ml.train_clustering --k 4

# 4. Run cross-city evaluation and generate report
python -m ml.evaluate

# 5. Run ML unit tests
python -m unittest ml.test_ml_pipeline
```
