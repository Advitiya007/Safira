"""Model bundle: fitted K-Means + imputer + scaler + feature spec + profiles + metadata.

Artifacts (per scope/version directory):
  kmeans.joblib, scaler.joblib, imputer.joblib, model.json
``models/<scope>/latest.json`` points at the active version. Loading uses joblib/pickle, so
only load artifacts from a directory you control.
"""

from __future__ import annotations

import json
import re
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.cluster import KMeans

from .config import model_dir
from .preprocessing import FittedTransformer, TransformSpec

_SAFE = re.compile(r"^[A-Za-z0-9._-]+$")


def _check_name(value: str, label: str) -> str:
    if not _SAFE.match(value or ""):
        raise ValueError(f"Invalid {label} '{value}'")
    return value


@dataclass
class ModelBundle:
    kmeans: KMeans
    transformer: FittedTransformer
    meta: dict

    @property
    def version(self) -> str:
        return self.meta["modelVersion"]

    @property
    def scope(self) -> str:
        return self.meta["scope"]

    def cluster_names(self) -> dict:
        return {c["clusterId"]: c["name"] for c in self.meta["clusters"]}

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        """Assign clusters with the FITTED scaler/imputer/model (never refits)."""
        X, imputed = self.transformer.transform(df)
        labels = self.kmeans.predict(X)
        centers = self.kmeans.cluster_centers_[labels]
        distance = np.linalg.norm(X - centers, axis=1)
        p99 = {c["clusterId"]: c.get("trainingDistanceP99") for c in self.meta["clusters"]}
        names = self.cluster_names()
        out = pd.DataFrame({
            "cluster_id": labels.astype(int),
            "cluster_name": [names[int(label)] for label in labels],
            "distance_to_centroid": np.round(distance, 4),
        }, index=df.index)
        out["atypical"] = [
            bool(p99[int(l)] is not None and d > p99[int(l)]) for l, d in zip(labels, distance)
        ]
        out["imputed_features"] = [
            [name for name, flag in row.items() if flag] for _, row in imputed.iterrows()
        ]
        return out


def _write_json(path: Path, payload: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    temporary.replace(path)


def save_bundle(bundle: ModelBundle, root: Optional[Path] = None, make_latest: bool = True) -> Path:
    root = Path(root) if root else model_dir()
    directory = root / _check_name(bundle.scope, "scope") / _check_name(bundle.version, "version")
    directory.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle.kmeans, directory / "kmeans.joblib")
    joblib.dump(bundle.transformer.scaler, directory / "scaler.joblib")
    joblib.dump(bundle.transformer.imputer, directory / "imputer.joblib")
    meta = dict(bundle.meta)
    meta["features"] = {**meta.get("features", {}), "spec": bundle.transformer.spec.to_dict()}
    _write_json(directory / "model.json", meta)
    if make_latest:
        _write_json(root / bundle.scope / "latest.json", {"version": bundle.version})
    return directory


def available_versions(scope: str, root: Optional[Path] = None) -> list[str]:
    base = (Path(root) if root else model_dir()) / _check_name(scope, "scope")
    if not base.exists():
        return []
    return sorted(p.name for p in base.iterdir() if p.is_dir() and (p / "model.json").exists())


def load_bundle(scope: str, version: Optional[str] = None, root: Optional[Path] = None) -> ModelBundle:
    root = Path(root) if root else model_dir()
    scope_dir = root / _check_name(scope, "scope")
    if version is None:
        latest = scope_dir / "latest.json"
        if not latest.exists():
            raise FileNotFoundError(f"No trained model for scope '{scope}'")
        version = json.loads(latest.read_text(encoding="utf-8"))["version"]
    directory = scope_dir / _check_name(version, "version")
    if not (directory / "model.json").exists():
        raise FileNotFoundError(f"Model '{scope}/{version}' not found")
    meta = json.loads((directory / "model.json").read_text(encoding="utf-8"))
    trained_with = meta.get("libraryVersions", {}).get("scikit-learn")
    if trained_with and trained_with.split(".")[:2] != sklearn.__version__.split(".")[:2]:
        warnings.warn(
            f"Model trained with scikit-learn {trained_with}; running {sklearn.__version__}. "
            "Retrain if predictions look wrong.", stacklevel=2,
        )
    spec = TransformSpec.from_dict(meta["features"]["spec"])
    transformer = FittedTransformer(
        spec, joblib.load(directory / "imputer.joblib"), joblib.load(directory / "scaler.joblib")
    )
    return ModelBundle(joblib.load(directory / "kmeans.joblib"), transformer, meta)
