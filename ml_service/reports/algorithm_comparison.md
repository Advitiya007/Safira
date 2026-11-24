# Clustering algorithm comparison

Clusters describe the availability and spatial distribution of mapped OpenStreetMap infrastructure. They are not crime predictions, do not measure safety, and a missing mapped feature is not proof that it does not exist.

Data: 3999 road segments (city-balanced subsample) from bathinda, delhi, jalandhar; features: length_m, police_count, police_nearest_m, hospital_count, hospital_nearest_m, pharmacy_count, pharmacy_nearest_m, shop_count, transport_count, establishment_density_per_km2.

## Requirements an algorithm must meet (gates)

1. **Scores new segments with the saved model** (native `predict`, reproduces its own labels).
2. **Every segment gets a profile** (noise <= 5%).
3. **Reproducible** (stability ARI >= 0.6).

Survivors are ranked by average rank on: silhouette, stability, cross-city transfer, low city-dependence (NMI), Davies-Bouldin. If a simpler method is within 0.03 of the winner, the simpler one is recommended.

## Results

| Algorithm | k | Silhouette | Stability (ARI) | Cross-city transfer (ARI) | City NMI (lower=better) | Noise | Native predict | Fit s | Passes gates | Avg rank |
|---|---|---|---|---|---|---|---|---|---|---|
| DBSCAN | 5 | 0.22 | 0.92 | 0.34 | 0.03 | 9% | no | 5.2 | no | 3.80 |
| K-Means **(recommended)** | 2 | 0.35 | 0.99 | 0.02 | 0.28 | 0% | yes | 0.0 | yes | 4.60 |
| Birch | 2 | 0.48 | 0.73 | -0.03 | 0.08 | 0% | yes | 0.2 | yes | 4.60 |
| MiniBatch K-Means | 2 | 0.40 | 0.76 | 0.01 | 0.25 | 0% | yes | 0.1 | yes | 4.80 |
| Bisecting K-Means | 2 | 0.35 | 0.98 | 0.02 | 0.28 | 0% | yes | 0.0 | yes | 4.80 |
| Gaussian Mixture (full) | 2 | 0.31 | 1.00 | 0.34 | 0.30 | 0% | yes | 0.1 | yes | 5.20 |
| HDBSCAN | 5 | 0.10 | 0.97 | 0.28 | 0.08 | 35% | no | 3.5 | no | 6.00 |
| Gaussian Mixture (diagonal) | 2 | 0.31 | 0.76 | 0.37 | 0.30 | 0% | yes | 0.0 | yes | 6.20 |
| Agglomerative (Ward) | 2 | 0.32 | 0.31 | 0.26 | 0.31 | 0% | no | 0.3 | no | 7.00 |
| Spectral | 2 | 0.28 | 0.30 | 0.23 | 0.30 | 0% | no | 0.3 | no | 8.00 |

## Recommendation

**K-Means** - lowest average rank (4.60) among algorithms that pass every requirement.

## Why the others were not chosen

**MiniBatch K-Means** - Same idea as K-Means but approximate; only worth it for millions of rows.

- stabilityARI 0.76 vs 0.99 for K-Means

**Bisecting K-Means** - Splits clusters top-down; gives a hierarchy but is rarely better than plain K-Means.

- Passed all requirements but ranked lower overall.

**Gaussian Mixture (diagonal)** - Soft membership and elliptical clusters, but assumes bell-shaped data; our counts and 0/1 columns are not bell-shaped.

- silhouette 0.31 vs 0.35 for K-Means
- stabilityARI 0.76 vs 0.99 for K-Means
- daviesBouldin 1.53 vs 1.40 for K-Means

**Gaussian Mixture (full)** - Most flexible shapes but many parameters per cluster; unstable and slow with lumpy, discrete features.

- silhouette 0.31 vs 0.35 for K-Means
- daviesBouldin 1.53 vs 1.40 for K-Means

**Birch** - Fast single-pass summary tree; result depends on data order and a distance threshold.

- stabilityARI 0.73 vs 0.99 for K-Means
- transferARI -0.03 vs 0.02 for K-Means

**Agglomerative (Ward)** - Good quality but has no 'predict': new segments cannot be scored without bolting on a second model, and it needs memory that grows with the square of the data.

- has no native predict: a saved model could not score new segments by itself, so production would need a second 'surrogate' model on top (in this run the surrogate matched the algorithm's own labels for 93% of segments, so the problem is structural, not accuracy)
- stability ARI 0.31 (minimum 0.60)
- stabilityARI 0.31 vs 0.99 for K-Means
- cityNMI 0.31 vs 0.28 for K-Means
- daviesBouldin 1.48 vs 1.40 for K-Means

**Spectral** - Finds odd-shaped groups, but has no 'predict' and is slow and memory-hungry on a full road network.

- has no native predict: a saved model could not score new segments by itself, so production would need a second 'surrogate' model on top (in this run the surrogate matched the algorithm's own labels for 93% of segments, so the problem is structural, not accuracy)
- stability ARI 0.30 (minimum 0.60)
- silhouette 0.28 vs 0.35 for K-Means
- stabilityARI 0.30 vs 0.99 for K-Means
- daviesBouldin 1.51 vs 1.40 for K-Means

**DBSCAN** - Finds dense regions and calls everything else 'noise'. Road infrastructure is a smooth gradient, not islands, and we need a profile for every segment.

- has no native predict: a saved model could not score new segments by itself, so production would need a second 'surrogate' model on top (in this run the surrogate matched the algorithm's own labels for 80% of segments, so the problem is structural, not accuracy)
- 9% of segments left as 'noise' (limit 5%)
- silhouette 0.22 vs 0.35 for K-Means
- stabilityARI 0.92 vs 0.99 for K-Means

**HDBSCAN** - Like DBSCAN but with variable density; still labels points as noise and has no predict.

- has no native predict: a saved model could not score new segments by itself, so production would need a second 'surrogate' model on top (in this run the surrogate matched the algorithm's own labels for 52% of segments, so the problem is structural, not accuracy)
- 35% of segments left as 'noise' (limit 5%)
- silhouette 0.10 vs 0.35 for K-Means
- daviesBouldin 1.59 vs 1.40 for K-Means

## Reading this fairly

- Silhouette and Davies-Bouldin reward round, compact clusters, which favours K-Means-style methods. Stability, city NMI and cross-city transfer do not share that bias.
- Near-ties are expected between K-Means, MiniBatch and Bisecting K-Means; differences of a few hundredths are not meaningful.
- DBSCAN/HDBSCAN silhouettes are computed ONLY on the points they kept. A method that discards many segments as 'noise' can look well separated; check its Noise column before comparing.
- No metric here measures safety; there are no safety labels.
