"""Cleaning, missing-value handling and scaling.

Pipeline for every row (training and inference alike):
  raw features -> log1p on skewed columns -> median imputation (fitted) -> StandardScaler
  (fitted) on the numeric part; road group is appended as unscaled one-hot columns.

Features with too much missingness (typically the explicit-tag accessibility columns)
are dropped automatically and recorded; they are never silently filled with guesses.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler

from .config import LOG1P_FEATURES, MODEL_NUMERIC_CANDIDATES, ROAD_GROUPS, TrainingParams


@dataclass
class TransformSpec:
    numeric: list
    log1p: list
    road_groups: list

    def one_hot_columns(self) -> list:
        return [f"road_group__{g}" for g in self.road_groups]

    @property
    def feature_names(self) -> list:
        return [*self.numeric, *self.one_hot_columns()]

    def to_dict(self) -> dict:
        return {"numeric": self.numeric, "log1p": self.log1p, "roadGroups": self.road_groups}

    @classmethod
    def from_dict(cls, data: dict) -> "TransformSpec":
        return cls(list(data["numeric"]), list(data["log1p"]), list(data["roadGroups"]))


def prepare_training_frame(df: pd.DataFrame, params: TrainingParams) -> tuple[pd.DataFrame, dict]:
    """Drop duplicates, too-short segments and (optionally) bbox-edge segments."""
    exclusions = {"input": int(len(df))}
    frame = df.drop_duplicates(subset=["cityId", "segment_key"])
    exclusions["duplicates"] = exclusions["input"] - int(len(frame))
    before = len(frame)
    frame = frame[~frame["is_short"].astype(bool)]
    exclusions["short"] = before - int(len(frame))
    if params.exclude_edge_segments and "near_bbox_edge" in frame:
        before = len(frame)
        frame = frame[~frame["near_bbox_edge"].astype(bool)]
        exclusions["bbox_edge"] = before - int(len(frame))
    exclusions["kept"] = int(len(frame))
    return frame.reset_index(drop=True), exclusions


def select_model_features(frame: pd.DataFrame, params: TrainingParams) -> tuple[list, dict]:
    """Keep candidate features that are observed well enough in EVERY city present."""
    kept, dropped = [], {}
    for name in MODEL_NUMERIC_CANDIDATES:
        if name not in frame:
            dropped[name] = "column absent"
            continue
        coverage = frame.groupby("cityId")[name].apply(lambda s: float(s.notna().mean()))
        worst_city, worst = coverage.idxmin(), float(coverage.min())
        if worst < params.min_feature_coverage:
            dropped[name] = (
                f"observed for only {worst:.0%} of segments in {worst_city} "
                f"(minimum {params.min_feature_coverage:.0%})"
            )
            continue
        if frame[name].dropna().nunique() <= 1:
            dropped[name] = "constant across training segments"
            continue
        kept.append(name)
    return kept, dropped


def _numeric_matrix(df: pd.DataFrame, spec: TransformSpec) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    for name in spec.numeric:
        values = pd.to_numeric(df[name], errors="coerce") if name in df else pd.Series(np.nan, index=df.index)
        values = values.astype(float)
        if name in spec.log1p:
            values = np.log1p(values.clip(lower=0))
        out[name] = values
    return out


def _one_hot(df: pd.DataFrame, spec: TransformSpec) -> np.ndarray:
    groups = df["road_group"] if "road_group" in df else pd.Series("", index=df.index)
    return np.column_stack([(groups == g).astype(float).to_numpy() for g in spec.road_groups])


class FittedTransformer:
    def __init__(self, spec: TransformSpec, imputer: SimpleImputer, scaler: StandardScaler):
        self.spec, self.imputer, self.scaler = spec, imputer, scaler

    @classmethod
    def fit(cls, df: pd.DataFrame, spec: TransformSpec) -> "FittedTransformer":
        numeric = _numeric_matrix(df, spec)
        imputer = SimpleImputer(strategy="median", keep_empty_features=True).fit(numeric)
        scaler = StandardScaler().fit(imputer.transform(numeric))
        return cls(spec, imputer, scaler)

    def transform(self, df: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
        """Return (scaled matrix, boolean frame marking values that had to be imputed)."""
        numeric = _numeric_matrix(df, self.spec)
        imputed_mask = numeric.isna()
        scaled = self.scaler.transform(self.imputer.transform(numeric))
        return np.hstack([scaled, _one_hot(df, self.spec)]), imputed_mask


def default_spec(numeric: list) -> TransformSpec:
    return TransformSpec(
        numeric=list(numeric),
        log1p=[n for n in numeric if n in LOG1P_FEATURES],
        road_groups=list(ROAD_GROUPS),
    )
