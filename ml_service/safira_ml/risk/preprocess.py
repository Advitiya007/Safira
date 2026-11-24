"""P4.1 - leakage-safe preprocessing for the supervised pipeline (no model is trained here).

``RiskPreprocessor`` is fitted on TRAINING rows only (medians, scaling statistics, which missing-indicator columns exist)
and then applied unchanged to validation/test rows, so held-out cities never influence the transformation.

Presets (a ``PreprocessSpec`` chooses what is appropriate for the model family; P4.2+ will pick one per algorithm):
* ``LINEAR``   - impute (median) + missing indicators + log1p on heavy-tailed counts/distances + standardise.
* ``TREE``     - impute + missing indicators, no scaling (scaling is irrelevant for trees).
* ``BOOSTING`` - keeps NaN as NaN (XGBoost / LightGBM treat missing natively), no scaling.

Missing is information ("OSM has no mapped record"), not zero: indicators make that visible to the model, and
all-missing columns are dropped. Unknown or missing category labels never crash: they go to an explicit
``__other__`` column and are counted in ``last_report_``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Optional

import numpy as np
import pandas as pd

from ..config import LOG1P_FEATURES
from .training_data import (CATEGORICAL_FEATURES, FEATURE_COLUMNS, NUMERIC_FEATURES, LeakageError, TrainingDataError,
                            assert_no_leakage, sanitise_numeric)

OTHER = "__other__"


@dataclass(frozen=True)
class PreprocessSpec:
    name: str = "custom"
    impute: bool = True
    add_missing_indicators: bool = True
    log_transform: bool = False
    scale: bool = False
    use_month: bool = False        # cyclical month-of-year; off by default (few months of data would just memorise them)


LINEAR = PreprocessSpec("linear", impute=True, add_missing_indicators=True, log_transform=True, scale=True)
TREE = PreprocessSpec("tree", impute=True, add_missing_indicators=True)
BOOSTING = PreprocessSpec("boosting", impute=False, add_missing_indicators=False)
PRESETS = {spec.name: spec for spec in (LINEAR, TREE, BOOSTING)}


class RiskPreprocessor:
    def __init__(self, spec: PreprocessSpec = TREE):
        self.spec = spec
        self.fitted = False
        self.last_report_: dict = {}

    # ---- helpers -------------------------------------------------------------------------------------------------
    @staticmethod
    def _check_columns(X: pd.DataFrame) -> None:
        extra = [c for c in X.columns if c not in FEATURE_COLUMNS]
        if extra:
            raise LeakageError("preprocessor received non-predictor columns (identifiers/metadata/label-derived?): "
                               + ", ".join(extra))
        assert_no_leakage(list(X.columns))

    def _numeric(self, X: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
        clean, invalid = sanitise_numeric(X)
        frame = clean[[c for c in self.numeric_in_ if c in clean.columns]].copy() if self.fitted else clean
        if self.spec.log_transform:
            for column in frame.columns:
                if column in LOG1P_FEATURES:
                    frame[column] = np.log1p(frame[column])
        return frame, invalid

    # ---- fit / transform -------------------------------------------------------------------------------------------
    def fit(self, X: pd.DataFrame) -> "RiskPreprocessor":
        self._check_columns(X)
        if len(X) == 0:
            raise TrainingDataError("cannot fit a preprocessor on zero rows")
        self.fitted = False
        numeric_present = [c for c in NUMERIC_FEATURES if c in X.columns]
        clean, _ = sanitise_numeric(X)
        values = clean[numeric_present].copy()
        if self.spec.log_transform:
            for column in values.columns:
                if column in LOG1P_FEATURES:
                    values[column] = np.log1p(values[column])
        self.dropped_all_missing_ = [c for c in numeric_present if values[c].isna().all()]
        values = values.drop(columns=self.dropped_all_missing_)
        self.medians_ = {c: float(values[c].median()) for c in values.columns}
        self.indicator_columns_ = ([c for c in values.columns if values[c].isna().any()]
                                   if self.spec.add_missing_indicators else [])
        filled = values.fillna(pd.Series(self.medians_)) if self.spec.impute else values
        self.dropped_constant_ = [c for c in filled.columns if np.nanstd(filled[c].to_numpy(float)) == 0.0]
        self.numeric_in_ = [c for c in filled.columns if c not in self.dropped_constant_]
        self.means_ = {c: float(np.nanmean(filled[c])) for c in self.numeric_in_}
        self.stds_ = {c: float(np.nanstd(filled[c])) for c in self.numeric_in_}
        self.categorical_levels_ = {c: list(levels) for c, levels in CATEGORICAL_FEATURES.items() if c in X.columns}
        if self.spec.use_month and "month_of_year" not in X.columns:
            raise TrainingDataError("use_month=True needs the month_of_year column")
        self.input_columns_ = list(X.columns)
        self.fitted = True
        self.feature_names_ = self._names()
        return self

    def _names(self) -> list[str]:
        names = list(self.numeric_in_)
        names += [f"{c}__missing" for c in self.indicator_columns_]
        for column, levels in self.categorical_levels_.items():
            names += [f"{column}={level}" for level in levels] + [f"{column}={OTHER}"]
        if self.spec.use_month:
            names += ["month_sin", "month_cos"]
        return names

    def transform(self, X: pd.DataFrame) -> np.ndarray:
        if not self.fitted:
            raise TrainingDataError("preprocessor is not fitted")
        self._check_columns(X)
        absent = [c for c in self.input_columns_ if c not in X.columns]
        if absent:
            raise TrainingDataError("missing columns at transform time: " + ", ".join(absent))
        values, invalid = self._numeric(X)
        report = {"invalidValuesSetToMissing": invalid, "imputedValues": {}, "unknownCategories": {}, "missingCategories": {}}
        raw_missing = values.isna()
        blocks = []
        numeric = values[self.numeric_in_].copy()
        if self.spec.impute:
            for column in numeric.columns:
                n = int(raw_missing[column].sum())
                if n:
                    report["imputedValues"][column] = n
            numeric = numeric.fillna(pd.Series(self.medians_))
        if self.spec.scale:
            for column in numeric.columns:
                numeric[column] = (numeric[column] - self.means_[column]) / (self.stds_[column] or 1.0)
        blocks.append(numeric.to_numpy(float))
        if self.indicator_columns_:
            sanitized, _ = sanitise_numeric(X)
            blocks.append(sanitized[self.indicator_columns_].isna().to_numpy(float))
        for column, levels in self.categorical_levels_.items():
            text = X[column].astype("string").str.strip().str.lower()
            known = text.isin(levels)
            one_hot = np.column_stack([(text == level).fillna(False).to_numpy(float) for level in levels]
                                      + [(~known).to_numpy(float)])
            blocks.append(one_hot)
            missing = int(text.isna().sum())
            unknown = text[~known & text.notna()].value_counts().to_dict()
            if missing:
                report["missingCategories"][column] = missing
            if unknown:
                report["unknownCategories"][column] = {str(k): int(v) for k, v in unknown.items()}
        if self.spec.use_month:
            angle = 2 * np.pi * (pd.to_numeric(X["month_of_year"], errors="coerce").fillna(1).to_numpy(float) - 1) / 12
            blocks.append(np.column_stack([np.sin(angle), np.cos(angle)]))
        self.last_report_ = report
        matrix = np.hstack(blocks) if blocks else np.empty((len(X), 0))
        assert matrix.shape[1] == len(self.feature_names_), "feature name/column mismatch"
        return matrix

    def fit_transform(self, X: pd.DataFrame) -> np.ndarray:
        return self.fit(X).transform(X)

    def get_state(self) -> dict:
        """JSON-serialisable description of what was learned from the training rows (for the model card)."""
        if not self.fitted:
            raise TrainingDataError("preprocessor is not fitted")
        return {"spec": asdict(self.spec), "featureNames": self.feature_names_, "medians": self.medians_,
                "means": self.means_, "stds": self.stds_, "missingIndicatorFor": self.indicator_columns_,
                "droppedAllMissing": self.dropped_all_missing_, "droppedConstant": self.dropped_constant_,
                "categoricalLevels": self.categorical_levels_}
