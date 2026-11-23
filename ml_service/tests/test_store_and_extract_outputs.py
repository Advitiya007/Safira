from tests.mockdb import mock_collection
import numpy as np
import pandas as pd

from safira_ml.extract import to_mongo_documents, write_city_csv
from safira_ml.store import SegmentStore
from safira_ml.training import train_model


def test_mongo_documents_keep_unknown_as_null_and_zero_as_zero(city_frames):
    frames, metas = city_frames
    docs = to_mongo_documents(frames["bathinda"], metas["bathinda"])
    sample = docs[0]
    assert sample["features"]["pharmacy_count"] is None and sample["features"]["pharmacy_nearest_m"] is None
    assert sample["features"]["police_count"] is not None
    assert sample["geometry"]["type"] == "LineString" and sample["modelAssignment"] is None
    assert sample["extraction"]["classAvailability"]["pharmacy"] is False
    assert isinstance(sample["features"]["police_count"], int)


def test_csv_replaces_only_the_extracted_city(city_frames, tmp_path):
    frames, metas = city_frames
    path = tmp_path / "road_features.csv"
    for city in ("jalandhar", "bathinda"):
        write_city_csv(frames[city], metas[city], path)
    write_city_csv(frames["jalandhar"], {**metas["jalandhar"], "runId": "second"}, path)
    frame = pd.read_csv(path)
    assert frame.groupby("cityId").size().to_dict() == {"bathinda": 840, "jalandhar": 840}
    assert set(frame.loc[frame.cityId == "jalandhar", "extraction_run_id"]) == {"second"}
    assert frame.loc[frame.cityId == "bathinda", "pharmacy_count"].isna().all()   # unknown survives CSV


def test_store_roundtrip_stale_cleanup_and_assignment(city_frames, params):
    frames, metas = city_frames
    store = SegmentStore(mock_collection())
    for city in frames:
        store.upsert_city(to_mongo_documents(frames[city], metas[city]), metas[city]["runId"])
    frame = store.training_frame()
    assert len(frame) == 840 * 3
    assert frame.loc[frame.cityId == "bathinda", "pharmacy_count"].isna().all()
    assert (frame.loc[frame.cityId == "jalandhar", "police_count"] >= 0).all()

    # re-extraction with a new run id removes stale rows of that city only
    again = to_mongo_documents(frames["delhi"].head(100), {**metas["delhi"], "runId": "new-run"})
    result = store.upsert_city(again, "new-run")
    assert result["removedStale"] == 740
    assert store.collection.count_documents({"cityId": "delhi"}) == 100
    assert store.collection.count_documents({"cityId": "jalandhar"}) == 840

    trained = train_model(frame, "global", params)
    summary = store.assign_clusters(trained.bundle)
    assert summary["assigned"] == store.collection.count_documents({})
    doc = store.collection.find_one({"cityId": "jalandhar"})
    assert doc["modelAssignment"]["modelVersion"] == trained.bundle.version
    assert doc["modelAssignment"]["clusterName"] in trained.bundle.cluster_names().values()
    # re-extracting a segment resets its (now stale) assignment
    store.upsert_city(to_mongo_documents(frames["jalandhar"].head(10), metas["jalandhar"]),
                      metas["jalandhar"]["runId"], replace_stale=False)
    assert store.collection.find_one({"cityId": "jalandhar", "segmentKey": frames["jalandhar"].segment_key.iloc[0]})["modelAssignment"] is None
