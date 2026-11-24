# Infrastructure clustering - evaluation

> Clusters describe the availability and spatial distribution of mapped OpenStreetMap infrastructure. They are not crime predictions, do not measure safety, and a missing mapped feature is not proof that it does not exist.

## City-specific models

| City | k (silhouette / elbow) | Silhouette | Davies-Bouldin | Stability (ARI) | Segments |
|---|---|---|---|---|---|
| bathinda | 2 (2 / 5) | 0.421 | 1.389 | 0.996 | 18018 |
| delhi | 2 (2 / 5) | 0.240 | 1.715 | 0.964 | 20000 |
| jalandhar | 5 (5 / 6) | 0.331 | 0.993 | 0.955 | 20000 |

## Global (cross-city) model

k = 2; silhouette 0.356; cluster-vs-city NMI 0.283 (0 = cluster membership independent of city, 1 = clusters are just cities).

Features used: length_m, police_count, police_nearest_m, hospital_count, hospital_nearest_m, pharmacy_count, pharmacy_nearest_m, shop_count, transport_count, establishment_density_per_km2.

Dropped features: foot_access (observed for only 0% of segments in jalandhar (minimum 60%)); vehicle_access (observed for only 0% of segments in jalandhar (minimum 60%)); sidewalk_present (observed for only 0% of segments in bathinda (minimum 60%)).

| Cluster | Segments | Service index |
|---|---|---|
| Infrastructure-sparse · mostly local streets | 39614 | -0.40 |
| Infrastructure-rich · mostly local streets | 18404 | 0.86 |

Features where city explains >=10% of variance: police_count (29%), police_nearest_m (39%), hospital_nearest_m (13%), pharmacy_count (37%), pharmacy_nearest_m (53%), shop_count (14%), transport_count (19%), establishment_density_per_km2 (22%).

## Leave-one-city-out generalisation

| Held-out city | Held-out silhouette | Train silhouette | Mean distance ratio | >P99 share | Imputed values | ARI vs city's own model |
|---|---|---|---|---|---|---|
| bathinda | 0.416 | 0.319 | 0.96 | 0.1% | 0.0% | 0.415 |
| delhi | 0.017 | 0.304 | 4.86 | 50.1% | 0.0% | 0.020 |
| jalandhar | 0.300 | 0.284 | 0.83 | 0.0% | 0.0% | 0.113 |

Plots: k_selection_bathinda.png, pca_bathinda.png, profiles_bathinda.png, k_selection_delhi.png, pca_delhi.png, profiles_delhi.png, k_selection_jalandhar.png, pca_jalandhar.png, profiles_jalandhar.png, k_selection_global.png, pca_global.png, profiles_global.png, cluster_city_composition.png
