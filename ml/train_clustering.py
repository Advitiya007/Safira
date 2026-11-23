"""
Model Training & Clustering Pipeline
Applies data preprocessing, log1p transformation on skewed count features,
StandardScaler, K-Means clustering, Elbow and Silhouette evaluation,
PCA visualization, and cluster profiling.
"""

import os
os.environ["LOKY_MAX_CPU_COUNT"] = "4"
os.environ["OMP_NUM_THREADS"] = "4"

import json
import joblib
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score, calinski_harabasz_score

from ml.config import (
    DATA_DIR,
    MODELS_DIR,
    FIGURES_DIR,
    REPORTS_DIR,
    NUMERICAL_FEATURES,
    K_RANGE,
    RANDOM_STATE,
    N_INIT,
    MAX_FACILITY_DISTANCE_METERS,
)

COUNT_FEATURES = [
    "police_count_1km",
    "hospital_count_1km",
    "pharmacy_count_500m",
    "shop_count_250m",
    "establishment_density_sqkm",
    "transit_count_500m",
    "lighting_signals_count",
]

DISTANCE_FEATURES = [
    "nearest_police_dist_m",
    "nearest_hospital_dist_m",
    "nearest_pharmacy_dist_m",
    "nearest_transit_dist_m",
]

def load_and_clean_data(input_path: Path = None) -> pd.DataFrame:
    """Loads feature parquet and handles missing or non-finite values."""
    path = input_path or (DATA_DIR / "features_combined.parquet")
    if not path.exists():
        raise FileNotFoundError(f"Feature dataset not found at {path}")
        
    df = pd.read_parquet(path)
    print(f"Loaded dataset with {len(df)} observations across cities: {df['city_id'].unique().tolist()}")
    
    for col in NUMERICAL_FEATURES:
        if col not in df.columns:
            raise KeyError(f"Required numerical feature '{col}' missing from dataset")
            
        df[col] = pd.to_numeric(df[col], errors='coerce')
        if "dist" in col:
            df[col] = df[col].fillna(MAX_FACILITY_DISTANCE_METERS)
            df[col] = df[col].clip(0.0, MAX_FACILITY_DISTANCE_METERS)
        else:
            df[col] = df[col].fillna(0.0)
            df[col] = df[col].clip(lower=0.0)
            
    df = df.dropna(subset=NUMERICAL_FEATURES).copy()
    return df

def transform_features(df: pd.DataFrame) -> tuple:
    """
    Transforms skewed count/density features with log1p and scales distances.
    Returns transformed DataFrame, scaled numpy array, and fitted StandardScaler.
    """
    X_df = df[NUMERICAL_FEATURES].copy()
    
    # Apply log1p to right-skewed count and establishment density features
    for col in COUNT_FEATURES:
        if col in X_df.columns:
            X_df[col] = np.log1p(X_df[col])
            
    # Normalize distance features by max range
    for col in DISTANCE_FEATURES:
        if col in X_df.columns:
            X_df[col] = X_df[col] / MAX_FACILITY_DISTANCE_METERS
            
    # Standardize to zero mean and unit variance
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_df.values)
    return X_df, X_scaled, scaler


def evaluate_k_selection(X_scaled: np.ndarray, k_range=K_RANGE) -> dict:
    """Evaluates K-Means across k range using Elbow method and Silhouette analysis."""
    print(f"\nEvaluating K-Means across k in {k_range}...")
    inertias = []
    silhouette_scores = []
    ch_scores = []
    
    sample_size = min(12000, len(X_scaled))
    np.random.seed(RANDOM_STATE)
    sample_indices = np.random.choice(len(X_scaled), size=sample_size, replace=False)
    X_sample = X_scaled[sample_indices]
    
    for k in k_range:
        kmeans = KMeans(n_clusters=k, n_init=N_INIT, random_state=RANDOM_STATE)
        kmeans.fit(X_scaled)
        inertias.append(float(kmeans.inertia_))
        
        labels_sample = kmeans.predict(X_sample)
        sil = float(silhouette_score(X_sample, labels_sample))
        ch = float(calinski_harabasz_score(X_sample, labels_sample))
        silhouette_scores.append(sil)
        ch_scores.append(ch)
        print(f"  k={k} -> Inertia: {kmeans.inertia_:.1f}, Silhouette: {sil:.4f}, Calinski-Harabasz: {ch:.1f}")
        
    # Plot Elbow Curve
    plt.figure(figsize=(8, 4.5))
    plt.plot(k_range, inertias, "bo-", linewidth=2, markersize=7)
    plt.title("Elbow Method: Inertia vs Number of Clusters (k)", fontsize=12, fontweight="bold")
    plt.xlabel("Number of Clusters (k)", fontsize=11)
    plt.ylabel("Inertia (Within-Cluster Sum of Squares)", fontsize=11)
    plt.grid(True, linestyle="--", alpha=0.6)
    plt.tight_layout()
    elbow_path = FIGURES_DIR / "elbow_curve.png"
    plt.savefig(elbow_path, dpi=200)
    plt.close()
    
    # Plot Silhouette Curve
    plt.figure(figsize=(8, 4.5))
    plt.plot(k_range, silhouette_scores, "rs-", linewidth=2, markersize=7)
    plt.title("Silhouette Analysis Across Cluster Counts", fontsize=12, fontweight="bold")
    plt.xlabel("Number of Clusters (k)", fontsize=11)
    plt.ylabel("Mean Silhouette Coefficient", fontsize=11)
    plt.grid(True, linestyle="--", alpha=0.6)
    plt.tight_layout()
    sil_path = FIGURES_DIR / "silhouette_scores.png"
    plt.savefig(sil_path, dpi=200)
    plt.close()
    
    return {
        "k_range": k_range,
        "inertias": inertias,
        "silhouette_scores": silhouette_scores,
        "calinski_harabasz_scores": ch_scores,
    }

def select_optimal_k(eval_results: dict) -> int:
    """Selects best k balancing silhouette coefficient and cluster interpretability."""
    k_range = eval_results["k_range"]
    sil_scores = eval_results["silhouette_scores"]
    
    # Best k based on silhouette peak
    best_idx = int(np.argmax(sil_scores))
    best_k = k_range[best_idx]
    
    # Prefer k=4 or k=5 if silhouette is within 0.03 of peak to ensure multi-tier urban profiling
    candidate_indices = [i for i, k in enumerate(k_range) if k in [4, 5]]
    if candidate_indices:
        best_candidate_idx = max(candidate_indices, key=lambda i: sil_scores[i])
        candidate_k = k_range[best_candidate_idx]
        if sil_scores[best_candidate_idx] >= sil_scores[best_idx] - 0.03:
            print(f"Selected k={candidate_k} (Silhouette: {sil_scores[best_candidate_idx]:.4f}) for balanced multi-tier urban infrastructure profiling.")
            return candidate_k
            
    print(f"Optimal k selected: {best_k} (Silhouette: {sil_scores[best_idx]:.4f})")
    return best_k

def generate_pca_visualization(X_scaled: np.ndarray, labels: np.ndarray, optimal_k: int) -> dict:
    """Performs PCA projection and plots 2D scatter with centroids."""
    pca = PCA(n_components=2, random_state=RANDOM_STATE)
    X_pca = pca.fit_transform(X_scaled)
    var_ratio = pca.explained_variance_ratio_
    
    plot_sample_size = min(10000, len(X_pca))
    np.random.seed(RANDOM_STATE)
    idx = np.random.choice(len(X_pca), size=plot_sample_size, replace=False)
    
    plt.figure(figsize=(9, 6.5))
    scatter = plt.scatter(
        X_pca[idx, 0],
        X_pca[idx, 1],
        c=labels[idx],
        cmap="Set2",
        alpha=0.5,
        s=14,
        edgecolors="none"
    )
    plt.colorbar(scatter, label="Cluster ID", ticks=range(optimal_k))
    plt.title(
        f"PCA Projection of Infrastructure Road Segments (k={optimal_k})\n"
        f"PC1: {var_ratio[0]*100:.1f}% Variance | PC2: {var_ratio[1]*100:.1f}% Variance",
        fontsize=12,
        fontweight="bold"
    )
    plt.xlabel(f"Principal Component 1 ({var_ratio[0]*100:.1f}% var)", fontsize=11)
    plt.ylabel(f"Principal Component 2 ({var_ratio[1]*100:.1f}% var)", fontsize=11)
    plt.grid(True, linestyle="--", alpha=0.5)
    plt.tight_layout()
    
    pca_fig_path = FIGURES_DIR / "pca_clusters.png"
    plt.savefig(pca_fig_path, dpi=200)
    plt.close()
    
    return {
        "pca_model": pca,
        "explained_variance_ratio": var_ratio.tolist(),
        "total_explained_variance": float(np.sum(var_ratio)),
    }

def profile_clusters(df: pd.DataFrame, optimal_k: int) -> dict:
    """Computes detailed feature profiles, archetypes, and summary statistics per cluster."""
    profiles = {}
    cluster_means = df.groupby("cluster")[NUMERICAL_FEATURES].mean()
    cluster_medians = df.groupby("cluster")[NUMERICAL_FEATURES].median()
    cluster_counts = df["cluster"].value_counts().sort_index().to_dict()
    
    for k in range(optimal_k):
        m = cluster_means.loc[k]
        med = cluster_medians.loc[k]
        count = cluster_counts.get(k, 0)
        pct = (count / len(df)) * 100
        
        # Determine archetype based on median & mean characteristics
        shop_count = m["shop_count_250m"]
        police_dist = m["nearest_police_dist_m"]
        hospital_dist = m["nearest_hospital_dist_m"]
        transit_count = m["transit_count_500m"]
        access_score = m["road_accessibility_score"]
        
        if shop_count >= 8.0 or (shop_count >= 4.0 and transit_count >= 3.0):
            archetype = "High-Density Commercial & Transit Hub"
            summary = "Dense commercial establishment corridor with high public transit access and frequent footfall potential."
        elif hospital_dist <= 700 and police_dist <= 1200:
            archetype = "Civic & Emergency-Proximate Urban Corridor"
            summary = "Close straight-line proximity to emergency services (police, hospitals, clinics) with moderate local commercial presence."
        elif transit_count >= 2.0 or m["road_accessibility_score"] >= 75:
            archetype = "Active Residential & Local Connector"
            summary = "Well-integrated residential or neighborhood connector with good pedestrian accessibility and regular transit stops."
        elif police_dist > 2000 and hospital_dist > 1800:
            archetype = "Peripheral / Isolated Low-Density Road"
            summary = "Peripheral, semi-rural, or isolated connector with low commercial presence and higher distances to emergency services."
        else:
            archetype = "Quiet Intermediate Urban Road"
            summary = "Intermediate urban road with balanced baseline infrastructure and moderate facility distances."
            
        profiles[str(k)] = {
            "cluster_id": k,
            "archetype_name": archetype,
            "description": summary,
            "sample_count": int(count),
            "sample_percentage": float(round(pct, 2)),
            "feature_means": m.round(2).to_dict(),
            "feature_medians": med.round(2).to_dict(),
        }
        
    # Grouped Bar Chart of Cluster Profiles
    plt.figure(figsize=(13, 6))
    features_to_plot = [
        "police_count_1km", "hospital_count_1km", "pharmacy_count_500m",
        "shop_count_250m", "transit_count_500m", "road_accessibility_score"
    ]
    x = np.arange(len(features_to_plot))
    width = 0.8 / optimal_k
    
    max_vals = cluster_means[features_to_plot].max().values
    for k in range(optimal_k):
        vals = [cluster_means.loc[k, f] for f in features_to_plot]
        norm_vals = [v / max(m_v, 1e-4) for v, m_v in zip(vals, max_vals)]
        label_text = f"C{k}: {profiles[str(k)]['archetype_name'][:25]} ({profiles[str(k)]['sample_percentage']}%)"
        plt.bar(x + k * width - 0.4 + width / 2, norm_vals, width, label=label_text)
        
    plt.xticks(x, [f.replace("_", " ").title() for f in features_to_plot], fontsize=10, rotation=15)
    plt.ylabel("Normalized Feature Intensity [0 - 1]", fontsize=11)
    plt.title(f"Infrastructure Profile Signatures Across Clusters (k={optimal_k})", fontsize=12, fontweight="bold")
    plt.legend(bbox_to_anchor=(1.02, 1), loc="upper left", fontsize=9)
    plt.grid(True, linestyle="--", alpha=0.5, axis="y")
    plt.tight_layout()
    
    fig_path = FIGURES_DIR / "cluster_feature_profiles.png"
    plt.savefig(fig_path, dpi=200)
    plt.close()
    
    return profiles

def train_pipeline(input_path: Path = None, optimal_k: int = None):
    """Executes the full end-to-end ML clustering training pipeline."""
    print("=" * 60)
    print("STARTING ML INFRASTRUCTURE CLUSTERING TRAINING PIPELINE")
    print("=" * 60)
    
    # 1. Load and clean
    df = load_and_clean_data(input_path)
    
    # 2. Transform features with log1p & StandardScaler
    print("\nTransforming skewed features and scaling with StandardScaler...")
    X_df, X_scaled, scaler = transform_features(df)
    
    # 3. Evaluate k if not explicitly given
    eval_results = evaluate_k_selection(X_scaled)
    if optimal_k is None:
        optimal_k = select_optimal_k(eval_results)
    else:
        print(f"Using specified k = {optimal_k}")
        
    # 4. Fit final K-Means
    print(f"\nTraining final K-Means model with k={optimal_k}...")
    kmeans = KMeans(n_clusters=optimal_k, n_init=N_INIT, random_state=RANDOM_STATE)
    df["cluster"] = kmeans.fit_predict(X_scaled)
    
    # 5. PCA visualization
    pca_results = generate_pca_visualization(X_scaled, df["cluster"].values, optimal_k)
    
    # 6. Cluster Profiling
    profiles = profile_clusters(df, optimal_k)
    
    # 7. Save artifacts
    print("\nSaving model artifacts to ml/models/...")
    joblib.dump(kmeans, MODELS_DIR / "kmeans_infrastructure.joblib")
    joblib.dump(scaler, MODELS_DIR / "scaler.joblib")
    joblib.dump(pca_results["pca_model"], MODELS_DIR / "pca_model.joblib")
    
    with open(MODELS_DIR / "feature_names.json", "w", encoding="utf-8") as f:
        json.dump(NUMERICAL_FEATURES, f, indent=2)
        
    with open(MODELS_DIR / "cluster_profiles.json", "w", encoding="utf-8") as f:
        json.dump(profiles, f, indent=2)
        
    with open(MODELS_DIR / "evaluation_metrics.json", "w", encoding="utf-8") as f:
        json.dump({
            "optimal_k": optimal_k,
            "evaluation": eval_results,
            "pca_explained_variance": pca_results["explained_variance_ratio"]
        }, f, indent=2)
        
    out_labeled = DATA_DIR / "features_with_clusters.parquet"
    df.to_parquet(out_labeled, index=False)
    print(f"Saved labeled observations to {out_labeled}")
    
    print("\n" + "=" * 60)
    print(f"TRAINING COMPLETE — OPTIMAL CLUSTERS: k={optimal_k}")
    print("=" * 60)
    for k, prof in profiles.items():
        print(f"  Cluster {k}: {prof['archetype_name']}")
        print(f"    Count: {prof['sample_count']:,} segments ({prof['sample_percentage']}%)")
        print(f"    Summary: {prof['description']}")
        
    return df, kmeans, scaler, profiles

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Train K-Means infrastructure clustering model.")
    parser.add_argument("--k", type=int, default=4, help="Number of clusters (default: 4 for multi-tier urban hierarchy)")
    parser.add_argument("--auto-k", action="store_true", help="Auto-select k based purely on mathematical silhouette peak")
    args = parser.parse_args()
    
    target_k = None if args.auto_k else args.k
    train_pipeline(optimal_k=target_k)
