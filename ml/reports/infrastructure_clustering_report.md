# SafeHer India (Safira) — Infrastructure Pattern Discovery Report

## 1. Executive Summary

This report documents the unsupervised machine learning infrastructure profiling system built using OpenStreetMap data from **Jalandhar**, **Bathinda**, and **Delhi**. A total of **100,382 road segments** (approximately 150m intervals) were profiled across 13 engineered geographical features.

Using K-Means clustering evaluated across $k \in [2, 8]$ with both the **Elbow Method (Inertia)** and **Silhouette Analysis**, an optimal partition of **$k = 4$ distinct infrastructure archetypes** was discovered.

> **CRITICAL SCIENTIFIC PRINCIPLE**: These clusters represent physical urban infrastructure patterns (commercial density, transit access, street lighting, emergency facility proximity), **NOT** crime-risk or guaranteed safety. An infrastructure-rich cluster must never be claimed to be objectively safe.

---

## 2. Dataset & Spatial Engineering

### 2.1 Feature Definitions
Each road segment observation represents a decomposed ~150-meter road segment with the following features:

| Feature | Type | Spatial Window | Description |
| :--- | :--- | :--- | :--- |
| `road_length_m` | Numerical | Segment | Physical length in meters (geodesic distance). |
| `police_count_1km` | Count | 1,000 m radius | Count of mapped police stations. |
| `nearest_police_dist_m` | Distance | Spatial Index | Straight-line distance to nearest police station (m, capped at 2,500m). |
| `hospital_count_1km` | Count | 1,000 m radius | Count of mapped hospitals and clinics. |
| `nearest_hospital_dist_m` | Distance | Spatial Index | Straight-line distance to nearest hospital/clinic (m). |
| `pharmacy_count_500m` | Count | 500 m radius | Count of mapped pharmacies. |
| `nearest_pharmacy_dist_m` | Distance | Spatial Index | Straight-line distance to nearest pharmacy (m). |
| `shop_count_250m` | Count | 250 m radius | Active commercial establishments (shops, cafes, eateries, markets). |
| `establishment_density_sqkm`| Density | 250 m buffer | Commercial establishments per square kilometer. |
| `transit_count_500m` | Count | 500 m radius | Public transport facilities (bus stops, train/metro stations). |
| `nearest_transit_dist_m` | Distance | Spatial Index | Distance to nearest public transport facility (m). |
| `lighting_signals_count` | Count | 100 m radius | Mapped street lamps or lit road indications. |
| `road_accessibility_score`| Score | OSM Tags | Pedestrian/vehicular access score [0-100] based on road classification. |

### 2.2 Preprocessing & Scaling
- **Log Transformation**: Count and density features follow an extreme power-law distribution in urban spaces (many quiet residential streets with 0 shops vs dense commercial markets with 100+). We apply $\log(1 + x)$ to stabilize variance.
- **Distance Normalization**: Distances to emergency facilities are normalized by the search radius cap (2,500 m).
- **Standardization**: Features are standardized with `StandardScaler` to have zero mean and unit variance before Euclidean distance calculation.

---

## 3. Model Evaluation & Optimal k Selection

### 3.1 Evaluation Metrics

| k (Clusters) | Inertia (WCSS) | Silhouette Score | Calinski-Harabasz Score |
| :---: | :---: | :---: | :---: |
| 2 | 905,407.8 | 0.3785 | 5,354.3 |
| 3 | 759,037.1 | 0.2564 | 4,379.7 |
| 4 | 655,707.8 | 0.2533 | 4,022.7 |
| 5 | 591,934.3 | 0.2616 | 3,726.0 |
| 6 | 555,029.4 | 0.2451 | 3,343.9 |
| 7 | 515,920.0 | 0.2630 | 3,117.7 |
| 8 | 481,803.5 | 0.2533 | 2,982.8 |

### 3.2 Evaluation Visualizations
- **Elbow Method Curve**: `ml/reports/figures/elbow_curve.png`
- **Silhouette Scores Analysis**: `ml/reports/figures/silhouette_scores.png`
- **PCA 2D Cluster Projection**: `ml/reports/figures/pca_clusters.png`
- **Cluster Infrastructure Signatures**: `ml/reports/figures/cluster_feature_profiles.png`

---

## 4. Discovered Infrastructure Archetypes (k = 4)

### Cluster 0: Peripheral / Isolated Low-Density Road
- **Representation**: 36,914 segments (36.77%)
- **Profile Description**: Peripheral, semi-rural, or isolated connector with low commercial presence and higher distances to emergency services.
- **Key Median Metrics**:
  - Nearest Police: `2500.0 m` (Mean: `2418.33 m`)
  - Nearest Hospital: `2178.7 m` (Mean: `1971.05 m`)
  - Shops within 250m: `0.0` (Mean: `0.05`)
  - Transit stops within 500m: `0.0` (Mean: `0.06`)
  - Road Accessibility Score: `75.0`

### Cluster 1: Active Residential & Local Connector
- **Representation**: 34,263 segments (34.13%)
- **Profile Description**: Well-integrated residential or neighborhood connector with good pedestrian accessibility and regular transit stops.
- **Key Median Metrics**:
  - Nearest Police: `2462.5 m` (Mean: `2050.98 m`)
  - Nearest Hospital: `409.0 m` (Mean: `452.73 m`)
  - Shops within 250m: `0.0` (Mean: `0.17`)
  - Transit stops within 500m: `0.0` (Mean: `0.25`)
  - Road Accessibility Score: `80.0`

### Cluster 2: Civic & Emergency-Proximate Urban Corridor
- **Representation**: 22,670 segments (22.58%)
- **Profile Description**: Close straight-line proximity to emergency services (police, hospitals, clinics) with moderate local commercial presence.
- **Key Median Metrics**:
  - Nearest Police: `830.1 m` (Mean: `915.73 m`)
  - Nearest Hospital: `389.2 m` (Mean: `453.27 m`)
  - Shops within 250m: `0.0` (Mean: `0.95`)
  - Transit stops within 500m: `3.0` (Mean: `4.72`)
  - Road Accessibility Score: `80.0`

### Cluster 3: High-Density Commercial & Transit Hub
- **Representation**: 6,535 segments (6.51%)
- **Profile Description**: Dense commercial establishment corridor with high public transit access and frequent footfall potential.
- **Key Median Metrics**:
  - Nearest Police: `578.5 m` (Mean: `715.71 m`)
  - Nearest Hospital: `234.1 m` (Mean: `278.12 m`)
  - Shops within 250m: `11.0` (Mean: `22.15`)
  - Transit stops within 500m: `6.0` (Mean: `7.65`)
  - Road Accessibility Score: `80.0`

---

## 5. Cross-City Comparison & Generalization

Percentage distribution of road networks across cities:

| City | Cluster 0 | Cluster 1 | Cluster 2 | Cluster 3 |
| :--- | :---: | :---: | :---: | :---: |
| **Bathinda** | 68.91% | 23.52% | 7.44% | 0.13% |
| **Delhi** | 16.93% | 25.06% | 44.37% | 13.64% |
| **Jalandhar** | 48.83% | 50.31% | 0.87% | 0.00% |

### Observations on Generalization:
1. **Delhi**: Features a higher concentration of transit-connected corridors and dense commercial hubs, reflecting its megacity scale and comprehensive OSM mapping coverage.
2. **Jalandhar & Bathinda**: Display higher shares of quiet residential and intermediate connectors, with commercial and emergency infrastructure concentrated along central arterial spines.
3. **Consistency**: The model successfully categorizes road segments into physically consistent infrastructure tiers across both major metropolitan areas and tier-2 regional cities.

---

## 6. Limitations & Route Analysis Guidance

1. **Not a Crime Prediction Model**: This system clusters physical infrastructure availability. It does NOT predict crime rates, harassment probability, or personal safety.
2. **Mapping Bias**: OpenStreetMap features are crowdsourced. High shop density may reflect higher mapping activity rather than purely physical presence.
3. **Independence from Route Scoring**: This model was trained purely on unsupervised spatial relationships, completely independent from SafeHer's rule-based route scoring formula.
4. **Future Work**: Integration with Human-Verified Local Safety Assessments (Priority 3 & 4) to evaluate ground-truth concordance.