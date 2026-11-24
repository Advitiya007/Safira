"""P4.1 tests: training-data loader, preprocessing, missing values, unknown labels, leakage, origin safeguards.

Every dataset here is a SYNTHETIC TEST FIXTURE built with P3's own builder inside pytest ``tmp_path`` (records carry the
``synthetic`` id prefix, so P3 marks them synthetic). No model is trained anywhere in this file.
"""
import json
import subprocess
import sys

import numpy as np
import pandas as pd
import pytest

from safira_ml.risk.labels import NotTrainableError
from safira_ml.risk.preprocess import BOOSTING, LINEAR, OTHER, TREE, PreprocessSpec, RiskPreprocessor
from safira_ml.risk.training_data import (EXCLUDED_COLUMNS, FEATURE_COLUMNS, METADATA_COLUMNS, SYNTHETIC_WATERMARK,
                                          DatasetOriginError, LeakageError, TrainingDataError, UnclassifiedColumnError,
                                          assert_no_leakage, assert_not_mixed, classify_columns, load_training_data,
                                          sanitise_numeric)
from tests.test_risk_dataset import build, inc, seg_rows, win

CITIES = ("jalandhar", "bathinda", "delhi")


def synthetic_dataset(tmp_path, name="syn", prefix="synthetic"):
    segments = [row for city in CITIES for row in seg_rows(city, n=6)]
    incidents = [inc(city, 75, 0, f"{prefix}-{city}") for city in CITIES]
    return build(tmp_path, segments, incidents, [win(city) for city in CITIES], name=name)


@pytest.fixture()
def syn(tmp_path):
    return synthetic_dataset(tmp_path)


def edit_observations(result, mutate):
    path = result.dataset_dir / "observations.csv"
    frame = pd.read_csv(path, keep_default_na=False)
    mutate(frame)
    frame.to_csv(path, index=False)


# ---- loader ------------------------------------------------------------------------------------------------------

def test_loader_separates_X_y_meta_and_marks_synthetic(syn):
    data = load_training_data(syn.dataset_dir, "synthetic")
    assert len(data) == len(data.X) == len(data.y) == len(data.meta) == len(data.weights) == 864
    assert set(data.y.unique()) == {0, 1} and int(data.y.sum()) == 3
    assert data.is_synthetic and data.watermark == SYNTHETIC_WATERMARK
    assert data.provenance["dataOrigin"] == "synthetic" and data.provenance["observationsSha256"]
    assert set(data.X.columns) <= set(FEATURE_COLUMNS) and {"road_group", "time_band", "month_of_year"} <= set(data.X.columns)
    # city + geography preserved for later geographic validation, but NOT in X
    assert {"city_id", "segment_key", "mid_lat", "mid_lon", "period", "period_start", "observation_id"} <= set(data.meta.columns)
    assert not set(data.X.columns) & set(METADATA_COLUMNS)
    assert set(data.meta["city_id"]) == set(CITIES)
    summary = data.describe()
    assert summary["watermark"] and summary["positivesByCity"] == {c: 1 for c in CITIES}


def test_every_p3_observation_column_is_classified_and_label_columns_are_excluded(syn):
    columns = pd.read_csv(syn.dataset_dir / "observations.csv", nrows=1).columns
    roles = classify_columns(columns)
    assert "unclassified" not in roles.values()
    for leaky in ("label_reason", "incident_count", "incident_ids", "incident_sources", "nearest_incident_distance_m",
                  "coverage_status", "coverage_window_ids", "match_radius_m", "match_mode", "training_exclusion_reason"):
        assert roles[leaky] == "excluded" and leaky in EXCLUDED_COLUMNS
    assert roles["label"] == "target" and roles["city_id"] == roles["mid_lat"] == "metadata"


def test_unclassified_new_p3_column_is_refused(syn):
    edit_observations(syn, lambda f: f.__setitem__("mystery_signal", 1))
    with pytest.raises(UnclassifiedColumnError, match="mystery_signal"):
        load_training_data(syn.dataset_dir, "synthetic")


def test_only_training_eligible_rows_are_loaded(syn):
    def mutate(frame):
        frame.loc[0, "training_eligible"] = False
        frame.loc[0, "training_exclusion_reason"] = "positive_outside_complete_coverage"
    edit_observations(syn, mutate)
    data = load_training_data(syn.dataset_dir, "synthetic")
    assert len(data) == 863 and data.report["droppedNotTrainingEligible"] == 1
    assert data.report["droppedReasons"] == {"positive_outside_complete_coverage": 1}


@pytest.mark.parametrize("mutate,message", [
    (lambda f: f.__setitem__("label", [2] + [0] * (len(f) - 1)), "label must be 0 or 1"),
    (lambda f: f.__setitem__("observation_id", ["x"] * len(f)), "duplicate observation_id"),
    (lambda f: f.__setitem__("period", ["2024-13"] * len(f)), "YYYY-MM"),
])
def test_invalid_label_ids_and_periods_fail_loudly(syn, mutate, message):
    edit_observations(syn, mutate)
    with pytest.raises(TrainingDataError, match=message):
        load_training_data(syn.dataset_dir, "synthetic")


def test_invalid_numeric_values_become_missing_and_are_counted_blank_is_just_missing(syn):
    def mutate(frame):
        for column in ("police_count", "police_nearest_m", "hospital_nearest_m", "length_m", "vehicle_access", "shop_count"):
            frame[column] = frame[column].astype(object)
        frame.loc[0, "police_count"] = -3                    # negative count
        frame.loc[1, "police_nearest_m"] = "abc"             # not a number
        frame.loc[2, "hospital_nearest_m"] = "inf"           # infinite
        frame.loc[3, "length_m"] = 0                         # non-positive length
        frame.loc[4, "vehicle_access"] = 2                   # access tag outside {0,1}
        frame.loc[5, "shop_count"] = ""                      # blank: missing, not invalid
    edit_observations(syn, mutate)
    data = load_training_data(syn.dataset_dir, "synthetic")
    assert data.report["invalidValuesSetToMissing"] == {"police_count": 1, "police_nearest_m": 1, "hospital_nearest_m": 1,
                                                        "length_m": 1, "vehicle_access": 1}
    assert pd.isna(data.X.loc[0, "police_count"]) and pd.isna(data.X.loc[1, "police_nearest_m"])
    assert pd.isna(data.X.loc[5, "shop_count"]) and "shop_count" not in data.report["invalidValuesSetToMissing"]
    assert data.report["missingShare"]["foot_access"] == 1.0           # explicit-tag feature absent in the fixture
    assert np.isfinite(data.X["length_m"].dropna()).all()


def test_unknown_category_labels_are_normalised_and_reported(syn):
    def mutate(frame):
        frame.loc[0, "road_group"] = " LOCAL "               # case/whitespace -> known level
        frame.loc[1, "road_group"] = "highway_of_doom"        # unknown level
    edit_observations(syn, mutate)
    data = load_training_data(syn.dataset_dir, "synthetic")
    assert data.X.loc[0, "road_group"] == "local"
    assert data.report["unknownCategories"] == {"road_group": ["highway_of_doom"]}


# ---- origin safeguards -------------------------------------------------------------------------------------------

def test_synthetic_cannot_be_loaded_as_real_and_real_is_gated(tmp_path, syn):
    with pytest.raises(DatasetOriginError, match="origin='real'"):
        load_training_data(syn.dataset_dir, "real")
    real = synthetic_dataset(tmp_path, "real", prefix="rec")             # no synthetic marker -> P3 calls it real
    assert real.manifest["dataOrigin"] == "real" and not real.trainable
    with pytest.raises(NotTrainableError):
        load_training_data(real.dataset_dir, "real")                      # P3's hard gate applies to real data
    with pytest.raises(DatasetOriginError, match="origin='synthetic'"):
        load_training_data(real.dataset_dir, "synthetic")
    inspected = load_training_data(real.dataset_dir, "real", enforce_gate=False)   # inspection only, never for training
    assert not inspected.is_synthetic and inspected.watermark is None and not inspected.provenance["gateEnforced"]


def test_tampered_origin_column_or_manifest_is_detected(syn):
    edit_observations(syn, lambda f: f.__setitem__("data_origin", ["real"] + ["synthetic"] * (len(f) - 1)))
    with pytest.raises(DatasetOriginError, match="data_origin"):
        load_training_data(syn.dataset_dir, "synthetic")
    manifest = syn.dataset_dir / "manifest.json"
    data = json.loads(manifest.read_text())
    data["isSynthetic"] = False
    manifest.write_text(json.dumps(data))
    with pytest.raises(DatasetOriginError):
        load_training_data(syn.dataset_dir, "synthetic")


def test_datasets_of_different_origin_are_never_mixed(tmp_path, syn):
    real = synthetic_dataset(tmp_path, "real", prefix="rec")
    a = load_training_data(syn.dataset_dir, "synthetic")
    b = load_training_data(real.dataset_dir, "real", enforce_gate=False)
    assert_not_mixed(a, a)
    with pytest.raises(DatasetOriginError, match="mix"):
        assert_not_mixed(a, b)


def test_pointer_resolution_uses_the_matching_latest_file(syn):
    root = syn.dataset_dir.parent
    assert load_training_data(root, "synthetic").provenance["datasetId"] == syn.manifest["datasetId"]
    with pytest.raises(TrainingDataError, match="latest.json"):
        load_training_data(root, "real")               # only a synthetic pointer exists: never fall back to it


# ---- leakage guard -----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["label", "label_reason", "incident_count", "incident_ids", "coverage_status",
                                  "nearest_incident_distance_m", "city_id", "segment_key", "mid_lat", "mid_lon",
                                  "period", "observation_id", "data_origin", "training_eligible", "match_mode",
                                  "my_incident_rate", "city_dummy_delhi"])
def test_leaky_or_identifier_columns_are_rejected_as_predictors(name):
    with pytest.raises(LeakageError):
        assert_no_leakage(["length_m", name])


def test_legitimate_features_pass_the_guard():
    assert_no_leakage(list(FEATURE_COLUMNS))


@pytest.mark.parametrize("name", ["incident_count", "city_id", "mid_lat", "label", "observation_id", "any_unlisted_column"])
def test_preprocessor_refuses_metadata_or_label_derived_columns(syn, name):
    X = load_training_data(syn.dataset_dir, "synthetic").X.assign(**{name: 1})
    with pytest.raises(LeakageError):
        RiskPreprocessor(TREE).fit(X)


def test_no_p3_label_generation_column_reaches_X_or_the_matrix(syn):
    data = load_training_data(syn.dataset_dir, "synthetic")
    pre = RiskPreprocessor(LINEAR).fit(data.X)
    banned = ("incident", "coverage", "label", "match_", "city", "mid_", "observation", "segment_key", "period")
    assert not [n for n in pre.feature_names_ if any(b in n for b in banned)]


# ---- preprocessing -----------------------------------------------------------------------------------------------

def make_X(n=40, seed=0, with_missing=True):
    rng = np.random.default_rng(seed)
    X = pd.DataFrame({
        "length_m": rng.uniform(40, 200, n), "police_count": rng.integers(0, 5, n).astype(float),
        "police_nearest_m": rng.uniform(50, 3000, n), "shop_count": rng.integers(0, 20, n).astype(float),
        "establishment_density_per_km2": rng.uniform(0, 400, n), "vehicle_access": rng.integers(0, 2, n).astype(float),
        "road_group": rng.choice(["local", "major", "service"], n), "time_band": rng.choice(["night", "day"], n),
        "month_of_year": rng.integers(1, 13, n).astype(float)})
    if with_missing:
        X.loc[::5, "vehicle_access"] = np.nan
        X["foot_access"] = np.nan                                  # absent everywhere
        X["transport_count"] = 1.0                                 # constant
    return X


def test_linear_preset_scales_log_transforms_and_adds_indicators():
    X = make_X()
    pre = RiskPreprocessor(LINEAR)
    M = pre.fit_transform(X)
    names = pre.feature_names_
    assert M.shape == (len(X), len(names)) and np.isfinite(M).all()
    for column in ("length_m", "police_nearest_m", "shop_count"):
        col = M[:, names.index(column)]
        assert abs(col.mean()) < 1e-9 and abs(col.std() - 1) < 1e-9
    assert "vehicle_access__missing" in names and "length_m__missing" not in names
    assert "foot_access" in pre.get_state()["droppedAllMissing"] and "transport_count" in pre.get_state()["droppedConstant"]
    assert "foot_access" not in names and "transport_count" not in names


def test_tree_preset_keeps_raw_scale_and_boosting_keeps_nan():
    X = make_X()
    tree = RiskPreprocessor(TREE)
    M = tree.fit_transform(X)
    assert np.allclose(M[:, tree.feature_names_.index("length_m")], X["length_m"])       # no scaling, no log
    assert np.isfinite(M).all()
    boost = RiskPreprocessor(BOOSTING)
    B = boost.fit_transform(X)
    assert np.isnan(B[:, boost.feature_names_.index("vehicle_access")]).sum() == X["vehicle_access"].isna().sum()
    assert not any(n.endswith("__missing") for n in boost.feature_names_)


def test_statistics_come_from_training_rows_only_never_from_the_held_out_rows():
    train, test = make_X(40, seed=1), make_X(40, seed=2)
    train.loc[::4, "police_nearest_m"] = np.nan
    test["police_nearest_m"] = 10_000.0                            # shifted held-out distribution
    pre = RiskPreprocessor(TREE).fit(train)
    median = float(train["police_nearest_m"].median())
    test.loc[0, "police_nearest_m"] = np.nan
    M = pre.transform(test)
    assert M[0, pre.feature_names_.index("police_nearest_m")] == pytest.approx(median)   # train median, not test
    assert pre.get_state()["medians"]["police_nearest_m"] == pytest.approx(median)
    assert pre.last_report_["imputedValues"]["police_nearest_m"] == 1


def test_missing_indicators_follow_the_training_data_even_if_test_has_new_missing():
    train, test = make_X(40, seed=1, with_missing=False), make_X(40, seed=2, with_missing=False)
    test.loc[3, "length_m"] = np.nan
    pre = RiskPreprocessor(TREE).fit(train)
    assert not any(n.endswith("__missing") for n in pre.feature_names_)       # schema fixed at fit time
    M = pre.transform(test)
    assert M.shape[1] == len(pre.feature_names_) and np.isfinite(M).all()


def test_one_hot_encoding_unknown_and_missing_labels_go_to_other_without_crashing():
    train = make_X()
    pre = RiskPreprocessor(TREE).fit(train)
    test = make_X(10, seed=5)
    test.loc[0, "road_group"] = "tunnel"
    test.loc[1, "road_group"] = None
    test.loc[2, "time_band"] = "midnight"
    M = pre.transform(test)
    names = pre.feature_names_
    for column in ("road_group", "time_band"):
        block = M[:, [i for i, n in enumerate(names) if n.startswith(f"{column}=")]]
        assert (block.sum(axis=1) == 1).all()                                  # exactly one level per row
    assert M[0, names.index(f"road_group={OTHER}")] == 1 and M[1, names.index(f"road_group={OTHER}")] == 1
    assert M[2, names.index(f"time_band={OTHER}")] == 1
    assert pre.last_report_["unknownCategories"] == {"road_group": {"tunnel": 1}, "time_band": {"midnight": 1}}
    assert pre.last_report_["missingCategories"] == {"road_group": 1}
    assert f"road_group=major" in names and f"time_band=night" in names        # fixed, stable schema


def test_invalid_values_at_transform_time_are_treated_as_missing_not_crash():
    pre = RiskPreprocessor(TREE).fit(make_X())
    bad = make_X(5, seed=3)
    bad["police_count"] = ["x", -1, np.inf, 2, 3]
    M = pre.transform(bad)
    assert np.isfinite(M).all() and pre.last_report_["invalidValuesSetToMissing"]["police_count"] == 3


def test_month_features_are_opt_in_and_cyclical():
    X = make_X()
    assert not any(n.startswith("month") for n in RiskPreprocessor(LINEAR).fit(X).feature_names_)
    pre = RiskPreprocessor(PreprocessSpec("m", use_month=True)).fit(X)
    M = pre.transform(X)
    sin, cos = M[:, pre.feature_names_.index("month_sin")], M[:, pre.feature_names_.index("month_cos")]
    assert np.allclose(sin ** 2 + cos ** 2, 1)


def test_transform_requires_fit_columns_and_deterministic_output():
    X = make_X()
    pre = RiskPreprocessor(LINEAR)
    with pytest.raises(TrainingDataError, match="not fitted"):
        pre.transform(X)
    with pytest.raises(TrainingDataError, match="zero rows"):
        RiskPreprocessor(LINEAR).fit(X.iloc[0:0])
    pre.fit(X)
    with pytest.raises(TrainingDataError, match="missing columns"):
        pre.transform(X.drop(columns=["length_m"]))
    assert np.array_equal(pre.transform(X), RiskPreprocessor(LINEAR).fit_transform(X))


def test_sanitise_numeric_rules():
    frame = pd.DataFrame({"length_m": [10, 0, -5, "x"], "police_count": [1, -1, np.nan, 2],
                          "foot_access": [0, 1, 2, np.nan], "police_nearest_m": [5, -2, np.inf, ""]})
    clean, invalid = sanitise_numeric(frame)
    assert clean["length_m"].isna().tolist() == [False, True, True, True]
    assert clean["foot_access"].isna().tolist() == [False, False, True, True]
    assert invalid == {"length_m": 3, "police_count": 1, "foot_access": 1, "police_nearest_m": 2}


# ---- end to end on the P3 fixture + CLI --------------------------------------------------------------------------

def test_end_to_end_fit_on_two_cities_transform_the_held_out_city(syn):
    data = load_training_data(syn.dataset_dir, "synthetic")
    train = data.meta["city_id"] != "delhi"
    pre = RiskPreprocessor(LINEAR).fit(data.X[train])
    held_out = pre.transform(data.X[~train])
    assert held_out.shape == (int((~train).sum()), len(pre.feature_names_)) and np.isfinite(held_out).all()
    assert set(data.meta.loc[~train, "city_id"]) == {"delhi"}                    # geography still available for validation


def test_inspect_training_data_cli_prints_watermarked_summary(syn):
    out = subprocess.run([sys.executable, "-m", "safira_ml.cli", "inspect-training-data", "--dataset", str(syn.dataset_dir),
                          "--origin", "synthetic"], capture_output=True, text=True,
                         cwd=str(__import__("pathlib").Path(__file__).resolve().parents[1]))
    assert out.returncode == 0, out.stderr
    summary = json.loads(out.stdout)
    assert summary["origin"] == "synthetic" and "SYNTHETIC" in summary["watermark"] and summary["positives"] == 3
    refused = subprocess.run([sys.executable, "-m", "safira_ml.cli", "inspect-training-data", "--dataset", str(syn.dataset_dir),
                              "--origin", "real"], capture_output=True, text=True,
                             cwd=str(__import__("pathlib").Path(__file__).resolve().parents[1]))
    assert refused.returncode == 2 and "origin" in refused.stderr
