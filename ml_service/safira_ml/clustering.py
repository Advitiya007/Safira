"""K-Means model selection, evaluation helpers, cluster profiling and descriptive naming.

Names describe mapped infrastructure only. They never use safe/unsafe wording.
"""

from __future__ import annotations

import math
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_rand_score, davies_bouldin_score, silhouette_score

from .config import ACCESS_COUNT_FEATURES, ACCESS_DISTANCE_FEATURES, TrainingParams
from .preprocessing import TransformSpec

ROAD_GROUP_LABELS = {
    "major": "major roads",
    "secondary_tertiary": "secondary/tertiary roads",
    "local": "local streets",
    "service": "service roads",
    "pedestrian_path": "pedestrian paths",
}


def fit_kmeans(X: np.ndarray, k: int, seed: int, n_init: int = 10) -> KMeans:
    return KMeans(n_clusters=k, n_init=n_init, random_state=seed).fit(X)


def _silhouette(X: np.ndarray, labels: np.ndarray, sample: int, seed: int) -> float:
    if len(np.unique(labels)) < 2:
        return float("nan")
    size = sample if len(X) > sample else None
    return float(silhouette_score(X, labels, sample_size=size, random_state=seed))


def evaluate_k_range(X: np.ndarray, params: TrainingParams) -> pd.DataFrame:
    rows = []
    k_max = min(params.k_max, max(2, len(X) // 50))
    for k in range(params.k_min, k_max + 1):
        model = fit_kmeans(X, k, params.seed, n_init=5)
        sizes = np.bincount(model.labels_, minlength=k) / len(X)
        rows.append({
            "k": k,
            "inertia": float(model.inertia_),
            "silhouette": _silhouette(X, model.labels_, params.silhouette_sample, params.seed),
            "davies_bouldin": float(davies_bouldin_score(X, model.labels_)),
            "min_cluster_fraction": float(sizes.min()),
        })
    return pd.DataFrame(rows)


def elbow_k(table: pd.DataFrame) -> Optional[int]:
    """Knee of the inertia curve: farthest point from the chord joining the end points."""
    if len(table) < 3:
        return None
    k = table["k"].to_numpy(dtype=float)
    inertia = table["inertia"].to_numpy(dtype=float)
    if np.ptp(inertia) == 0:
        return None
    x = (k - k.min()) / np.ptp(k)
    y = (inertia - inertia.min()) / np.ptp(inertia)
    # chord from (x0, y0) to (x1, y1); distance of each point to that line
    dx, dy = x[-1] - x[0], y[-1] - y[0]
    distance = np.abs(dy * (x - x[0]) - dx * (y - y[0])) / math.hypot(dx, dy)
    return int(k[int(np.argmax(distance))])


def choose_k(table: pd.DataFrame, params: TrainingParams) -> tuple[int, dict]:
    """Highest silhouette among k whose smallest cluster is not tiny. Always a suggestion."""
    valid = table[table["min_cluster_fraction"] >= params.min_cluster_fraction]
    pool = valid if len(valid) else table
    best = pool.sort_values(["silhouette", "k"], ascending=[False, True]).iloc[0]
    info = {
        "method": "max silhouette among k with min cluster fraction >= "
                  f"{params.min_cluster_fraction:.0%}",
        "silhouetteChoice": int(best["k"]),
        "elbowChoice": elbow_k(table),
        "note": "Automatic choice is a suggestion; compare the elbow and silhouette curves "
                "and override with an explicit k if domain review prefers another value.",
    }
    return int(best["k"]), info


def bootstrap_stability(X: np.ndarray, reference: np.ndarray, k: int, params: TrainingParams) -> dict:
    """Mean ARI between the reference clustering and fits on random 80% subsets."""
    rng = np.random.default_rng(params.seed)
    scores = []
    n = len(X)
    for run in range(params.stability_runs):
        subset = rng.choice(n, size=max(k * 20, int(n * 0.8)), replace=False)
        model = fit_kmeans(X[subset], k, params.seed + run + 1, n_init=3)
        scores.append(adjusted_rand_score(reference, model.predict(X)))
    return {"meanARI": float(np.mean(scores)), "minARI": float(np.min(scores)), "runs": len(scores)}


# ---- profiling -----------------------------------------------------------------------

def _stats(series: pd.Series) -> dict:
    values = pd.to_numeric(series, errors="coerce")
    observed = values.dropna()
    if observed.empty:
        return {"mean": None, "median": None, "std": None, "p25": None, "p75": None, "missingShare": 1.0}
    return {
        "mean": round(float(observed.mean()), 3),
        "median": round(float(observed.median()), 3),
        "std": round(float(observed.std(ddof=0)), 3),
        "p25": round(float(observed.quantile(0.25)), 3),
        "p75": round(float(observed.quantile(0.75)), 3),
        "missingShare": round(float(values.isna().mean()), 3),
    }


def service_index(centroid_z: dict) -> Optional[float]:
    """Mean of standardised access features (higher = more mapped infrastructure nearby).

    Distance features are negated so that 'closer' raises the index. Used only to rank and
    name clusters - it is not a score that is shown to users or used for routing.
    """
    parts = [centroid_z[f] for f in ACCESS_COUNT_FEATURES if f in centroid_z]
    parts += [-centroid_z[f] for f in ACCESS_DISTANCE_FEATURES if f in centroid_z]
    return float(np.mean(parts)) if parts else None


def _standout(centroid_z: dict) -> Optional[str]:
    candidates = []
    density = [centroid_z[f] for f in ("shop_count", "establishment_density_per_km2") if f in centroid_z]
    if density:
        candidates.append((float(np.mean(density)), "dense mapped establishments", "few mapped establishments"))
    if "transport_count" in centroid_z:
        candidates.append((centroid_z["transport_count"], "near mapped transport", "little mapped transport"))
    if "length_m" in centroid_z:
        candidates.append((centroid_z["length_m"], "long segments", "short segments"))
    candidates = [c for c in candidates if abs(c[0]) >= 0.75]
    if not candidates:
        return None
    value, high, low = max(candidates, key=lambda c: abs(c[0]))
    return high if value > 0 else low


def build_profiles(
    raw: pd.DataFrame,
    labels: np.ndarray,
    centroids_numeric: np.ndarray,
    spec: TransformSpec,
    distances: np.ndarray,
) -> list[dict]:
    """Cluster profiles in raw units plus names/descriptions derived from the data."""
    k = centroids_numeric.shape[0]
    raw = raw.reset_index(drop=True)
    profiles = []
    for cluster in range(k):
        mask = labels == cluster
        members = raw[mask]
        z = {name: float(centroids_numeric[cluster, i]) for i, name in enumerate(spec.numeric)}
        group_share = (
            members["road_group"].value_counts(normalize=True).round(3).to_dict() if len(members) else {}
        )
        city_share = (
            members["cityId"].value_counts(normalize=True).round(3).to_dict() if len(members) else {}
        )
        profiles.append({
            "clusterId": cluster,
            "size": int(mask.sum()),
            "share": round(float(mask.mean()), 4),
            "serviceIndex": service_index(z),
            "centroidZ": {name: round(value, 3) for name, value in z.items()},
            "features": {name: _stats(members[name]) for name in spec.numeric if name in members},
            "roadGroupShares": group_share,
            "cityShares": city_share,
            "trainingDistanceP99": round(float(np.quantile(distances[mask], 0.99)), 4) if mask.any() else None,
        })
    assign_names(profiles)
    return profiles


def assign_names(profiles: list[dict]) -> None:
    indices = [p["serviceIndex"] for p in profiles if p["serviceIndex"] is not None]
    spread = (max(indices) - min(indices)) if len(indices) == len(profiles) and indices else 0.0
    ranked = sorted(profiles, key=lambda p: (p["serviceIndex"] is None, p["serviceIndex"] or 0.0))
    used: set = set()
    for position, profile in enumerate(ranked):
        if spread < 0.35 or len(profiles) == 1:
            level = "Mixed infrastructure"
        elif position == 0:
            level = "Infrastructure-sparse"
        elif position == len(ranked) - 1:
            level = "Infrastructure-rich"
        else:
            level = "Moderate infrastructure"
        shares = profile["roadGroupShares"]
        dominant = max(shares, key=shares.get) if shares else None
        suffix = None
        if dominant and shares[dominant] >= 0.5:
            suffix = f"mostly {ROAD_GROUP_LABELS.get(dominant, dominant)}"
        else:
            suffix = _standout(profile["centroidZ"])
        name = f"{level} · {suffix}" if suffix else level
        if name in used:
            name = f"{name} (cluster {profile['clusterId']})"
        used.add(name)
        profile["name"] = name
        profile["level"] = level
        profile["description"] = describe(profile)


def _fmt_metres(value) -> str:
    if value is None:
        return "unknown"
    return f"{value / 1000:.1f} km" if value >= 1000 else f"{value:.0f} m"


def describe(profile: dict) -> str:
    f = profile["features"]
    bits = []

    def median(name):
        item = f.get(name)
        return None if item is None else item["median"]

    nearest = []
    for label, key in (("police", "police_nearest_m"), ("hospital/clinic", "hospital_nearest_m"),
                       ("pharmacy", "pharmacy_nearest_m")):
        if key in f:
            nearest.append(f"{label} {_fmt_metres(median(key))}")
    if nearest:
        bits.append("Median distance to nearest mapped " + ", ".join(nearest) + ".")
    counts = []
    if "shop_count" in f and median("shop_count") is not None:
        counts.append(f"{median('shop_count'):.0f} shops")
    if "transport_count" in f and median("transport_count") is not None:
        counts.append(f"{median('transport_count'):.0f} public-transport stops")
    if counts:
        bits.append("Median nearby: " + ", ".join(counts) + " (within the activity radius).")
    shares = profile["roadGroupShares"]
    if shares:
        top = max(shares, key=shares.get)
        bits.append(f"{shares[top]:.0%} of segments are {ROAD_GROUP_LABELS.get(top, top)}.")
    bits.append("Describes mapped OpenStreetMap infrastructure only; not a safety rating.")
    return " ".join(bits)
