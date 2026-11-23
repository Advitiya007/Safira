import re

import numpy as np
import pandas as pd
import pytest

from safira_ml.config import TrainingParams
from safira_ml.persistence import load_bundle, save_bundle
from safira_ml.preprocessing import select_model_features, prepare_training_frame
from safira_ml.training import balanced_sample, train_model

def test_global_model_drops_feature_missing_in_one_city(all_frame, params):
    cleaned, _ = prepare_training_frame(all_frame, params)
    kept, dropped = select_model_features(cleaned, params)
    assert "pharmacy_count" in dropped and "pharmacy_nearest_m" in dropped   # Bathinda has none mapped
    assert "bathinda" in dropped["pharmacy_count"]
    assert {"foot_access", "vehicle_access", "sidewalk_present"} <= set(dropped)  # sparse explicit tags
    assert "police_nearest_m" in kept


def test_city_model_keeps_feature_that_exists_in_that_city(all_frame, params):
    cleaned, _ = prepare_training_frame(all_frame[all_frame.cityId == "jalandhar"], params)
    kept, _ = select_model_features(cleaned, params)
    assert "pharmacy_count" in kept


def test_k_is_selected_not_assumed(all_frame, params):
    result = train_model(all_frame, "global", params)
    table = result.k_table
    assert list(table["k"]) == list(range(2, 11))
    assert result.bundle.meta["k"] in set(table["k"])
    assert result.bundle.meta["kSelection"]["silhouetteChoice"] == result.bundle.meta["k"]
    forced = train_model(all_frame, "global", params, k=4)
    assert forced.bundle.meta["k"] == 4 and forced.bundle.meta["kSelection"]["userSpecified"]


def test_cluster_names_are_descriptive_and_never_safety_labels(all_frame, params):
    result = train_model(all_frame, "global", params)
    names = [c["name"] for c in result.bundle.meta["clusters"]]
    assert len(set(names)) == len(names)
    assert any(n.startswith("Infrastructure-rich") for n in names)
    assert any(n.startswith("Infrastructure-sparse") for n in names)
    forbidden = re.compile(r"\b(unsafe|dangerous|crime|risky|high[- ]risk|low[- ]risk|safest|safer)\b")
    for cluster in result.bundle.meta["clusters"]:
        assert not re.search(r"\bsafe\b", cluster["name"].lower())
        assert not forbidden.search((cluster["name"] + " " + cluster["description"]).lower())
        assert "not a safety rating" in cluster["description"]


def test_city_does_not_dominate_global_clusters(all_frame, params):
    result = train_model(all_frame, "global", params)
    assert result.bundle.meta["metrics"]["clusterCityNMI"] < 0.1


def test_balanced_sampling_caps_each_city(all_frame):
    sampled = balanced_sample(all_frame, 300, 1)
    assert sampled.groupby("cityId").size().max() == 300


def test_persistence_round_trip_uses_fitted_scaler_and_model(all_frame, params, tmp_path):
    result = train_model(all_frame, "global", params)
    save_bundle(result.bundle, tmp_path)
    loaded = load_bundle("global", root=tmp_path)
    assert loaded.version == result.bundle.version
    meta_files = {p.name for p in (tmp_path / "global" / loaded.version).iterdir()}
    assert meta_files == {"kmeans.joblib", "scaler.joblib", "imputer.joblib", "model.json"}
    rows = result.training_frame.head(200)
    expected = result.bundle.kmeans.predict(result.bundle.transformer.transform(rows)[0])
    assert (loaded.predict(rows)["cluster_id"].to_numpy() == expected).all()
    # a single new segment is assigned without refitting: scaler statistics must be unchanged
    before = loaded.transformer.scaler.mean_.copy()
    loaded.predict(rows.head(1))
    assert np.array_equal(before, loaded.transformer.scaler.mean_)


def test_unknown_inputs_are_imputed_and_reported(all_frame, params):
    result = train_model(all_frame, "global", params)
    row = all_frame.head(1).copy()
    row["police_nearest_m"] = np.nan
    out = result.bundle.predict(row)
    assert out["imputed_features"].iloc[0] == ["police_nearest_m"]


def test_version_names_are_path_safe(all_frame, params, tmp_path):
    result = train_model(all_frame, "global", params)
    with pytest.raises(ValueError):
        load_bundle("../etc", root=tmp_path)
    with pytest.raises(ValueError):
        load_bundle("global", "../../x", root=tmp_path)
