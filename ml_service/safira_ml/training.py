"""Train a K-Means infrastructure model for a scope ('global' = all cities, or one city id)."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd
import scipy
import sklearn
from sklearn.metrics import davies_bouldin_score, normalized_mutual_info_score

from . import PIPELINE_VERSION
from .clustering import (
    bootstrap_stability, build_profiles, choose_k, elbow_k, evaluate_k_range, fit_kmeans,
    _silhouette,
)
from .config import DISCLAIMER, ExtractionParams, TrainingParams
from .persistence import ModelBundle
from .preprocessing import (
    FittedTransformer, default_spec, prepare_training_frame, select_model_features,
)


@dataclass
class TrainResult:
    bundle: ModelBundle
    k_table: pd.DataFrame
    X: np.ndarray
    labels: np.ndarray
    training_frame: pd.DataFrame


def balanced_sample(frame: pd.DataFrame, cap: int, seed: int) -> pd.DataFrame:
    """At most ``cap`` rows per city (deterministic) so a large city cannot dominate."""
    parts = []
    for _, group in frame.groupby("cityId", sort=True):
        parts.append(group if len(group) <= cap else group.sample(n=cap, random_state=seed))
    return pd.concat(parts, ignore_index=True)


def train_model(
    df: pd.DataFrame,
    scope: str,
    params: Optional[TrainingParams] = None,
    k: Optional[int] = None,
    extraction_params: Optional[ExtractionParams] = None,
    source_data_versions: Optional[list] = None,
) -> TrainResult:
    params = params or TrainingParams()
    frame = df if scope == "global" else df[df["cityId"] == scope]
    if frame.empty:
        raise ValueError(f"No road-segment features available for scope '{scope}'")
    cleaned, exclusions = prepare_training_frame(frame, params)
    numeric, dropped = select_model_features(cleaned, params)
    if len(numeric) < 3:
        raise ValueError(f"Too few usable features after coverage checks: {numeric}")
    cities = sorted(cleaned["cityId"].unique())
    training = balanced_sample(cleaned, params.per_city_cap, params.seed)
    if len(training) < 100:
        raise ValueError(f"Only {len(training)} training segments; extract more data first")

    spec = default_spec(numeric)
    transformer = FittedTransformer.fit(training, spec)
    X, _ = transformer.transform(training)

    table = evaluate_k_range(X, params)
    if k is None:
        k, k_info = choose_k(table, params)
        k_info["userSpecified"] = False
    else:
        k_info = {"method": "user specified", "userSpecified": True,
                  "silhouetteChoice": choose_k(table, params)[0],
                  "elbowChoice": None}
        k_info["elbowChoice"] = elbow_k(table)
    model = fit_kmeans(X, k, params.seed, n_init=10)
    labels = model.labels_
    n_num = len(spec.numeric)
    distances = np.linalg.norm(X - model.cluster_centers_[labels], axis=1)
    profiles = build_profiles(
        training[[*spec.numeric, "road_group", "cityId"]], labels,
        model.cluster_centers_[:, :n_num], spec, distances,
    )

    metrics = {
        "silhouette": _silhouette(X, labels, params.silhouette_sample, params.seed),
        "silhouetteSampleSize": int(min(len(X), params.silhouette_sample)),
        "daviesBouldin": float(davies_bouldin_score(X, labels)),
        "inertia": float(model.inertia_),
        "stability": bootstrap_stability(X, labels, k, params),
    }
    if len(cities) > 1:
        metrics["clusterCityNMI"] = float(normalized_mutual_info_score(training["cityId"], labels))

    created = datetime.now(timezone.utc)
    fingerprint = hashlib.sha1(
        f"{scope}|{spec.feature_names}|{len(training)}|{k}|{params.seed}|{PIPELINE_VERSION}".encode()
    ).hexdigest()[:8]
    version = f"{scope}-k{k}-{created.strftime('%Y%m%d%H%M%S')}-{fingerprint}"
    meta = {
        "modelVersion": version,
        "scope": scope,
        "createdAt": created.isoformat(),
        "pipelineVersion": PIPELINE_VERSION,
        "algorithm": "KMeans on log1p -> median-imputed -> StandardScaler numeric features + road-group one-hot",
        "libraryVersions": {
            "scikit-learn": sklearn.__version__, "numpy": np.__version__,
            "pandas": pd.__version__, "scipy": scipy.__version__,
        },
        "features": {
            "numeric": spec.numeric, "oneHot": spec.one_hot_columns(),
            "droppedFeatures": dropped,
        },
        "extractionParams": (extraction_params or ExtractionParams()).to_dict(),
        "trainingParams": params.__dict__,
        "k": int(k),
        "kSelection": {**k_info, "table": table.round(5).to_dict("records")},
        "training": {
            "cities": cities,
            "segmentsAfterCleaning": int(len(cleaned)),
            "segmentsUsedForFitting": int(len(training)),
            "segmentsByCityUsed": training["cityId"].value_counts().sort_index().to_dict(),
            "exclusions": exclusions,
            "sourceDataVersions": sorted(source_data_versions or []),
        },
        "metrics": metrics,
        "clusters": profiles,
        "disclaimer": DISCLAIMER,
    }
    bundle = ModelBundle(model, transformer, meta)
    return TrainResult(bundle, table, X, labels, training)
