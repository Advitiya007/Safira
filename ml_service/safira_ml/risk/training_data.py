"""P4.1 - training-data loader for the supervised incident model.

Reads a P3 dataset directory (``observations.csv`` + ``manifest.json``) and returns
``X`` (predictor columns only), ``y`` (label), ``meta`` (identifiers, city, geography, period: kept for geographic
and temporal validation, NEVER predictors) plus full provenance. Nothing here fits or trains a model.

Design rules
* Closed-world column catalogue: every column P3 writes is classified (target / numeric / categorical / metadata /
  excluded-with-reason). A column nobody classified raises ``UnclassifiedColumnError``, so a future change to the P3
  schema cannot silently leak into the features.
* Leakage: label-generation columns (incident ids/counts, coverage, match settings, label_reason, nearest incident
  distance, ...) are excluded and ``assert_no_leakage`` re-checks any feature list.
* Synthetic vs real: the caller must state which origin it expects; the manifest and the ``data_origin`` column must
  agree. Synthetic data can never be loaded as real (or the reverse) and carries a watermark for every report.
* Real data additionally has to pass P3's trainability gate (``labels.require_trainable``).
* Invalid numeric values (negative counts/distances, non-numeric text, +-inf, non-positive length, access tags outside
  {0, 1}) become *missing* and are counted per column; nothing is imputed here (imputation is fitted on training folds only,
  in ``preprocess.RiskPreprocessor``).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from ..config import MODEL_NUMERIC_CANDIDATES, ROAD_GROUPS
from .config import TIME_BANDS, RiskConfig
from .labels import require_trainable

TARGET = "label"
BANDS = tuple(TIME_BANDS)
SYNTHETIC_WATERMARK = ("SYNTHETIC DEVELOPMENT DATA - not real incidents. Results say nothing about real-world "
                       "safety and must not be reported as prediction performance.")

# ---- column catalogue --------------------------------------------------------------------------------------------
NUMERIC_FEATURES = tuple(MODEL_NUMERIC_CANDIDATES)
COUNT_FEATURES = ("police_count", "hospital_count", "pharmacy_count", "shop_count", "transport_count")
DISTANCE_FEATURES = ("police_nearest_m", "hospital_nearest_m", "pharmacy_nearest_m", "establishment_density_per_km2")
BINARY_FEATURES = ("foot_access", "vehicle_access", "sidewalk_present")
CATEGORICAL_FEATURES = {"road_group": tuple(ROAD_GROUPS), "time_band": BANDS}
DERIVED_FEATURES = ("month_of_year",)          # derived from `period`; only used if a spec asks for it
FEATURE_COLUMNS = (*NUMERIC_FEATURES, *CATEGORICAL_FEATURES, *DERIVED_FEATURES)

METADATA_COLUMNS = ("observation_id", "city_id", "segment_key", "period", "mid_lat", "mid_lon")
REQUIRED_COLUMNS = (TARGET, "training_eligible", "data_origin", *METADATA_COLUMNS, "time_band")

EXCLUDED_COLUMNS = {
    "label_reason": "label-generation metadata (leaks the label)",
    "training_eligible": "row filter, not a predictor",
    "training_exclusion_reason": "label-generation metadata",
    "coverage_status": "label-generation metadata: coverage decides which rows can be negative",
    "coverage_window_ids": "label-generation metadata",
    "incident_count": "derived from the incidents that define the label",
    "incident_ids": "identifier of the incidents that define the label",
    "incident_sources": "derived from the incidents that define the label",
    "nearest_incident_distance_m": "derived from the incidents that define the label",
    "match_radius_m": "label-generation setting",
    "match_mode": "label-generation setting",
    "data_origin": "provenance (real/synthetic), not a predictor",
    "extraction_run_id": "identifier of the feature-extraction run",
    "lit_tag": "informational OSM tag, deliberately not modelled (P3 / K-Means rule)",
    "road_type": "high-cardinality OSM tag; the grouped `road_group` is used instead",
    "establishment_count": "redundant with establishment_density_per_km2",
    "is_short": "short segments are never labelled in P3 (constant); not a predictor",
    "near_bbox_edge": "data-quality flag about the import box, kept out so the model cannot learn a mapping artefact",
}
# Names that must never appear in a predictor list (substring match, case-insensitive).
FORBIDDEN_SUBSTRINGS = ("label", "incident", "coverage", "training_", "match_", "observation_id", "segment_key",
                        "extraction_run", "city", "mid_lat", "mid_lon", "period", "data_origin", "nearest_incident")


class TrainingDataError(ValueError):
    pass


class UnclassifiedColumnError(TrainingDataError):
    pass


class DatasetOriginError(TrainingDataError):
    pass


class LeakageError(TrainingDataError):
    pass


def classify_columns(columns) -> dict[str, str]:
    """Role of every column: target / numeric / categorical / derived / metadata / excluded / unclassified."""
    roles = {}
    for column in columns:
        if column == TARGET:
            roles[column] = "target"
        elif column in NUMERIC_FEATURES:
            roles[column] = "numeric"
        elif column in CATEGORICAL_FEATURES:
            roles[column] = "categorical"
        elif column in DERIVED_FEATURES:
            roles[column] = "derived"
        elif column in METADATA_COLUMNS:
            roles[column] = "metadata"
        elif column in EXCLUDED_COLUMNS:
            roles[column] = "excluded"
        else:
            roles[column] = "unclassified"
    return roles


def assert_no_leakage(feature_names) -> None:
    """Raise if any proposed predictor is label-derived, an identifier, a city/geography field or a period."""
    bad = sorted({name for name in feature_names
                  if name not in FEATURE_COLUMNS and any(token in name.lower() for token in FORBIDDEN_SUBSTRINGS)}
                 | {name for name in feature_names if name in EXCLUDED_COLUMNS or name in METADATA_COLUMNS or name == TARGET})
    if bad:
        raise LeakageError("these columns must never be predictors: " + ", ".join(bad))


def sanitise_numeric(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Coerce numeric features; invalid values become NaN. Returns (clean copy, {column: n_invalid}).

    Genuinely absent values (blank / NaN) are "missing", not "invalid"; they are left as NaN and not counted here.
    """
    out, invalid = frame.copy(), {}
    for column in NUMERIC_FEATURES:
        if column not in out.columns:
            continue
        original = out[column]
        values = pd.to_numeric(original, errors="coerce").astype(float)
        present = original.notna() & (original.astype(str).str.strip() != "")
        bad = present & ~np.isfinite(values)                 # non-numeric text, +-inf
        values = values.where(np.isfinite(values))
        if column in COUNT_FEATURES or column in DISTANCE_FEATURES:
            rule = values < 0
        elif column == "length_m":
            rule = values <= 0
        elif column in BINARY_FEATURES:
            rule = values.notna() & ~values.isin([0.0, 1.0])
        else:
            rule = pd.Series(False, index=values.index)
        bad |= rule
        out[column] = values.mask(rule)
        if int(bad.sum()):
            invalid[column] = int(bad.sum())
    return out, invalid


@dataclass
class TrainingData:
    X: pd.DataFrame              # predictor columns only (raw, NaN kept)
    y: pd.Series                 # int 0/1
    meta: pd.DataFrame           # observation_id, city_id, segment_key, period, period_start, mid_lat, mid_lon
    weights: pd.Series           # 1.0 (P3 does not down-sample); reserved for later milestones
    origin: str                  # "real" | "synthetic"
    provenance: dict
    report: dict = field(default_factory=dict)

    @property
    def is_synthetic(self) -> bool:
        return self.origin == "synthetic"

    @property
    def watermark(self) -> Optional[str]:
        return SYNTHETIC_WATERMARK if self.is_synthetic else None

    def __len__(self) -> int:
        return len(self.y)

    def describe(self) -> dict:
        positives = int(self.y.sum())
        return {"origin": self.origin, "watermark": self.watermark, "rows": len(self), "positives": positives,
                "negatives": len(self) - positives, "prevalence": round(positives / len(self), 6) if len(self) else None,
                "cities": self.meta["city_id"].value_counts().to_dict() if len(self) else {},
                "positivesByCity": self.y.groupby(self.meta["city_id"]).sum().astype(int).to_dict() if len(self) else {},
                "periods": [str(self.meta["period"].min()), str(self.meta["period"].max())] if len(self) else None,
                "features": list(self.X.columns), "provenance": self.provenance, "report": self.report}


def assert_not_mixed(*datasets: TrainingData) -> None:
    """Refuse to combine synthetic and real data, or data built from different datasets of different origins."""
    origins = {d.origin for d in datasets}
    if len(origins) > 1:
        raise DatasetOriginError("refusing to mix SYNTHETIC and REAL datasets: " + ", ".join(sorted(origins)))


def resolve_dataset_dir(dataset: Path, origin: str) -> Path:
    dataset = Path(dataset)
    if (dataset / "manifest.json").is_file():
        return dataset
    pointer = dataset / ("latest_synthetic.json" if origin == "synthetic" else "latest.json")
    if not pointer.is_file():
        raise TrainingDataError(f"no manifest.json in {dataset} and no {pointer.name} pointer: build a dataset first "
                                "(`python -m safira_ml.cli build-dataset`)")
    info = json.loads(pointer.read_text(encoding="utf-8"))
    local = dataset / f"dataset_{info['datasetId']}"
    return local if local.is_dir() else Path(info["path"])


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def load_training_data(dataset: Path, origin: str, enforce_gate: bool = True,
                       config: Optional[RiskConfig] = None) -> TrainingData:
    """Load a P3 dataset for training. ``origin`` ("real" or "synthetic") must match the dataset."""
    if origin not in ("real", "synthetic"):
        raise TrainingDataError("origin must be 'real' or 'synthetic'")
    directory = resolve_dataset_dir(dataset, origin)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    declared = manifest.get("dataOrigin")
    if declared != origin or bool(manifest.get("isSynthetic")) != (origin == "synthetic"):
        raise DatasetOriginError(f"dataset {manifest.get('datasetId')} is '{declared}' "
                                 f"(isSynthetic={manifest.get('isSynthetic')}), but origin='{origin}' was requested")
    if origin == "real" and enforce_gate:
        require_trainable(manifest)          # P3's hard gate: no honest labels -> no training data

    path = directory / "observations.csv"
    frame = pd.read_csv(path, low_memory=False)
    missing = [c for c in REQUIRED_COLUMNS if c not in frame.columns]
    if missing:
        raise TrainingDataError(f"{path}: missing required columns: {', '.join(missing)}")
    roles = classify_columns(frame.columns)
    unclassified = [c for c, role in roles.items() if role == "unclassified"]
    if unclassified:
        raise UnclassifiedColumnError("P3 wrote columns that P4.1 has not classified (predictor? identifier? leakage?): "
                                      + ", ".join(unclassified) + ". Classify them in risk/training_data.py first.")
    origins = set(frame["data_origin"].astype(str).unique())
    if origins != {origin}:
        raise DatasetOriginError(f"observations.csv data_origin values {sorted(origins)} do not match origin='{origin}'")

    report = {"rowsInFile": int(len(frame))}
    eligible = frame["training_eligible"].astype(str).str.lower().isin(["true", "1"])
    report["droppedNotTrainingEligible"] = int((~eligible).sum())
    if "training_exclusion_reason" in frame.columns:
        report["droppedReasons"] = frame.loc[~eligible, "training_exclusion_reason"].fillna("unspecified").value_counts().to_dict()
    frame = frame[eligible].reset_index(drop=True)

    label = pd.to_numeric(frame[TARGET], errors="coerce")
    if label.isna().any() or not label.isin([0, 1]).all():
        raise TrainingDataError("label must be 0 or 1 in every training-eligible row")
    if frame["observation_id"].duplicated().any():
        raise TrainingDataError("duplicate observation_id values in observations.csv")

    period_start = pd.to_datetime(frame["period"].astype(str) + "-01", format="%Y-%m-%d", errors="coerce")
    if period_start.isna().any():
        raise TrainingDataError("period must look like YYYY-MM in every row")
    frame["month_of_year"] = period_start.dt.month.astype(float)
    for column in CATEGORICAL_FEATURES:
        frame[column] = frame[column].astype("string").str.strip().str.lower()

    numeric, invalid = sanitise_numeric(frame)
    report["invalidValuesSetToMissing"] = invalid
    features = [c for c in FEATURE_COLUMNS if c in numeric.columns]
    assert_no_leakage(features)
    X = numeric[features].copy()
    meta = frame[list(METADATA_COLUMNS)].copy()
    meta["period_start"] = period_start
    report["missingShare"] = {c: round(float(X[c].isna().mean()), 4) for c in features if X[c].isna().any()}
    report["unknownCategories"] = {c: sorted(set(X[c].dropna().unique()) - set(CATEGORICAL_FEATURES[c]))
                                   for c in CATEGORICAL_FEATURES if c in X.columns
                                   and set(X[c].dropna().unique()) - set(CATEGORICAL_FEATURES[c])}
    report["featureCatalogue"] = {c: roles[c] for c in frame.columns if c in roles}

    provenance = {"datasetId": manifest.get("datasetId"), "dataOrigin": origin, "isSynthetic": origin == "synthetic",
                  "builderVersion": manifest.get("builderVersion"), "builtAt": manifest.get("builtAt"),
                  "datasetDir": str(directory), "observationsSha256": _sha256(path),
                  "manifestTrainable": bool(manifest.get("trainable")), "gateEnforced": bool(origin == "real" and enforce_gate),
                  "matchRadiusM": (manifest.get("config") or {}).get("label_radius_m"),
                  "watermark": SYNTHETIC_WATERMARK if origin == "synthetic" else None}
    return TrainingData(X=X, y=label.astype(int).reset_index(drop=True), meta=meta.reset_index(drop=True),
                        weights=pd.Series(1.0, index=X.index, name="weight"), origin=origin,
                        provenance=provenance, report=report)
