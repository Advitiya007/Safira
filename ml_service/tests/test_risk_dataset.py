"""Dataset-builder tests (P3).

EVERYTHING HERE IS SYNTHETIC TEST DATA. Segments and incidents are generated in code, written only below pytest's
tmp_path, and are not real geography or real incidents. Nothing here may be used as training data.
"""
import json
import os
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from pyproj import Transformer

from safira_ml.cli import main as cli_main
from safira_ml.config import CITY_BOUNDING_BOXES, RAW_FEATURE_COLUMNS
from safira_ml.geo import WGS84
from safira_ml.risk.adapters import BackendIncidentSource, FileIncidentSource, map_backend_documents
from safira_ml.risk.config import RiskConfig
from safira_ml.risk.coverage import CoverageError, parse_coverage
from safira_ml.risk.dataset import DatasetBuildError, build_dataset
from safira_ml.risk.labels import NotTrainableError, require_trainable
from safira_ml.risk.matching import crs_for_city

ML_SERVICE_DIR = Path(__file__).resolve().parents[1]
BANDS = ("night", "early", "day", "evening")


# ---- synthetic fixtures ---------------------------------------------------------------------------------------

def offset(city, east_m, north_m):
    """(lon, lat) of a point east/north of the city's bbox centre, using the builder's own projection."""
    box = CITY_BOUNDING_BOXES[city]
    centre = (box["west"] + box["east"]) / 2, (box["south"] + box["north"]) / 2
    crs = crs_for_city(city)
    x0, y0 = Transformer.from_crs(WGS84, crs, always_xy=True).transform(*centre)
    return Transformer.from_crs(crs, WGS84, always_xy=True).transform(x0 + east_m, y0 + north_m)


def seg_rows(city, n=6, spacing=400.0, length=150.0, north=0.0, prefix="seg", **overrides):
    rows = []
    for i in range(n):
        a, b = offset(city, i * spacing, north), offset(city, i * spacing + length, north)
        mid = offset(city, i * spacing + length / 2, north)
        row = {"segment_key": f"{city}-{prefix}-{i}", "cityId": city, "way_osm_id": 1000 + i, "road_type": "residential",
               "road_group": "local", "is_short": False, "mid_lon": mid[0], "mid_lat": mid[1], "length_m": length,
               "police_count": i, "police_nearest_m": 100.0 * (i + 1), "hospital_count": 0, "hospital_nearest_m": 900.0,
               "pharmacy_count": 1, "pharmacy_nearest_m": 300.0, "shop_count": 2 * i, "transport_count": 1,
               "establishment_count": 3, "establishment_density_per_km2": 50.0 + i, "foot_access": np.nan,
               "vehicle_access": 1.0, "sidewalk_present": np.nan, "lit_tag": "", "bbox_edge_distance_m": 5000.0,
               "near_bbox_edge": False, "extraction_run_id": "synthetic-run",
               "geometry_wkt": f"LINESTRING ({a[0]:.8f} {a[1]:.8f}, {b[0]:.8f} {b[1]:.8f})"}
        row.update(overrides)
        rows.append(row)
    return rows


def inc(city, east, north, incident_id="t1", **kw):
    lon, lat = offset(city, east, north)
    row = {"incident_id": incident_id, "source": "police", "category": "harassment",
           "occurred_at": "2024-03-05T23:30:00+05:30", "lat": f"{lat:.8f}", "lon": f"{lon:.8f}",
           "verification": "verified", "location_error_m": "30", "source_ref": f"ref-{incident_id}"}
    row.update(kw)
    return row


def win(city="delhi", **kw):
    base = {"source": "police", "city_id": city, "start": "2024-01-01", "end": "2025-01-01", "complete": True,
            "location_error_m": 50}
    base.update(kw)
    return base


def build(tmp_path, segments, incidents, windows=None, config=None, name="run"):
    root = tmp_path / name
    (root / "inc").mkdir(parents=True, exist_ok=True)
    features = root / "road_features.csv"
    pd.DataFrame(segments).to_csv(features, index=False)
    if incidents:
        pd.DataFrame(incidents).to_csv(root / "inc" / "incidents.csv", index=False)
    (root / "inc" / "coverage.json").write_text(json.dumps({"windows": windows or []}), encoding="utf-8")
    return build_dataset(features, FileIncidentSource(root / "inc"), root / "out", config, built_at="test")


def obs(result):
    return pd.read_csv(result.dataset_dir / "observations.csv", keep_default_na=False)


def rows_of(frame, **conditions):
    mask = pd.Series(True, index=frame.index)
    for key, value in conditions.items():
        mask &= frame[key] == value
    return frame[mask]


# ---- matching and positives -----------------------------------------------------------------------------------

def test_incident_matches_only_segments_within_radius_and_records_distance(tmp_path):
    result = build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30)], [win()])
    matches = pd.read_csv(result.dataset_dir / "incident_matches.csv")
    assert list(matches["segment_key"]) == ["delhi-seg-0"] and matches.iloc[0]["effect"] == "positive"
    assert abs(matches.iloc[0]["distance_m"] - 30) < 0.5
    data = obs(result)
    positives = rows_of(data, label=1)
    assert list(positives["segment_key"]) == ["delhi-seg-0"]       # seg-1 is ~325 m away: not matched


def test_positive_row_carries_labels_provenance_and_features(tmp_path):
    result = build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30)], [win()])
    row = rows_of(obs(result), label=1).iloc[0]
    assert (row["period"], row["time_band"]) == ("2024-03", "night")
    assert row["label_reason"] == "positive_verified_incident" and row["incident_ids"] == "t1"
    assert row["incident_sources"] == "police" and row["incident_count"] == 1
    assert row["coverage_status"] == "complete" and bool(row["training_eligible"]) and row["coverage_window_ids"].startswith("W000:police:delhi")
    assert abs(float(row["nearest_incident_distance_m"]) - 30) < 0.5 and row["data_origin"] == "real"
    assert row["police_nearest_m"] == 100.0 and row["match_radius_m"] == 100.0
    for column in RAW_FEATURE_COLUMNS:
        assert column in obs(result).columns


def test_missing_features_stay_missing_not_zero(tmp_path):
    data = obs(build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30)], [win()]))
    assert (data["foot_access"] == "").all() and (data["sidewalk_present"] == "").all()      # NaN, never 0


# ---- negatives and coverage -----------------------------------------------------------------------------------

def test_negative_labels_only_inside_complete_coverage(tmp_path):
    result = build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30)], [win()])
    data = obs(result)
    assert len(data) == 6 * 4 * 12                                    # Jan..Dec 2024, every segment and band
    assert (data["label"] == 1).sum() == 1 and (data["label"] == 0).sum() == len(data) - 1
    assert (rows_of(data, label=0)["coverage_status"] == "complete").all()
    assert rows_of(data, label=0)["training_eligible"].astype(bool).all()
    assert result.manifest["observations"]["unlabelled"] == 0


def test_without_any_coverage_window_there_are_no_negatives(tmp_path):
    result = build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30)], [])
    data = obs(result)
    assert list(data["label"]) == [1]
    row = data.iloc[0]
    assert row["coverage_status"] == "none" and not bool(row["training_eligible"])
    assert row["training_exclusion_reason"] == "positive_outside_complete_coverage"
    assert result.manifest["observations"]["positiveOutsideCompleteCoverage"] == 1
    assert result.manifest["observations"]["negative"] == 0 and result.trainable is False


@pytest.mark.parametrize("window_kw,reason", [
    ({"complete": False}, "declared_incomplete"),
    ({"location_error_m": 150}, "exceeds_radius"),
    ({"city": "jalandhar"}, "no_records_from_this_source"),
    ({"source": "ncrb"}, "no_records_from_this_source"),
])
def test_incomplete_or_unusable_windows_never_create_negatives(tmp_path, window_kw, reason):
    kw = dict(window_kw)
    city = kw.pop("city", "delhi")
    result = build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30)], [win(city, **kw)])
    audit = result.manifest["coverageWindows"][0]
    assert audit["usable"] is False and reason in audit["unusableReason"]
    data = obs(result)
    assert (data["label"] == 0).sum() == 0
    assert result.manifest["observations"]["negative"] == 0


def test_month_only_partly_covered_is_not_labelled_negative(tmp_path):
    result = build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30)], [win(end="2024-03-15")])
    data = obs(result)
    assert set(rows_of(data, label=0)["period"]) == {"2024-01", "2024-02"}      # March is not fully covered
    assert (rows_of(data, label=0).shape[0]) == 2 * 24
    march = rows_of(data, period="2024-03")
    assert list(march["label"]) == [1] and not bool(march.iloc[0]["training_eligible"])
    assert result.manifest["observations"]["unlabelledByReason"]["unlabelled_no_complete_coverage"] == 23


def test_geographic_bbox_limits_where_negatives_may_exist(tmp_path):
    west, south = offset("delhi", -100, -100)
    east, north = offset("delhi", 1000, 100)           # covers segments 0, 1, 2 only (they end at 150/550/950 m)
    box = {"south": south, "west": west, "north": north, "east": east}
    result = build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30)], [win(bbox=box)])
    negatives = rows_of(obs(result), label=0)
    assert set(negatives["segment_key"]) == {"delhi-seg-0", "delhi-seg-1", "delhi-seg-2"}


def test_coverage_bbox_validation():
    with pytest.raises(CoverageError):
        parse_coverage({"windows": [win(bbox={"south": 2, "west": 1, "north": 1, "east": 2})]})
    with pytest.raises(CoverageError):
        parse_coverage({"windows": [win(bbox={"south": 1})]})
    assert parse_coverage({"windows": [win()]})[0].bbox is None


# ---- dates, times, windows ------------------------------------------------------------------------------------

def test_local_time_bands_months_and_utc_conversion(tmp_path):
    cases = [  # (segment, timestamp, expected period, expected band)
        (0, "2024-03-05T04:59:00+05:30", "2024-03", "night"),
        (1, "2024-03-05T05:00:00+05:30", "2024-03", "early"),
        (2, "2024-03-31T23:59:00+05:30", "2024-03", "night"),
        (3, "2024-04-01T00:00:00+05:30", "2024-04", "night"),
        (4, "2024-03-31T19:00:00Z", "2024-04", "night"),          # 00:30 IST on 1 April
        (5, "2024-03-05T09:00:00+05:30", "2024-03", "day"),
    ]
    incidents = [inc("delhi", i * 400 + 75, 10, incident_id=f"c{i}", occurred_at=ts) for i, ts, *_ in cases]
    data = obs(build(tmp_path, seg_rows("delhi"), incidents, [win()]))
    got = {(r.segment_key, r.period, r.time_band) for r in rows_of(data, label=1).itertuples()}
    assert got == {(f"delhi-seg-{i}", period, band) for i, _ts, period, band in cases}


def test_band_edges_17_and_22(tmp_path):
    cases = [(0, "2024-05-10T16:59:00+05:30", "day"), (1, "2024-05-10T17:00:00+05:30", "evening"),
             (2, "2024-05-10T21:59:00+05:30", "evening"), (3, "2024-05-10T22:00:00+05:30", "night")]
    incidents = [inc("delhi", i * 400 + 75, 10, incident_id=f"e{i}", occurred_at=ts) for i, ts, _band in cases]
    data = obs(build(tmp_path, seg_rows("delhi"), incidents, [win()]))
    got = {(r.segment_key, r.time_band) for r in rows_of(data, label=1).itertuples()}
    assert got == {(f"delhi-seg-{i}", band) for i, _, band in cases}


def test_incident_labels_only_its_own_month_and_band(tmp_path):
    data = obs(build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30)], [win()]))
    same_segment = rows_of(data, segment_key="delhi-seg-0")
    assert (rows_of(same_segment, period="2024-03", time_band="day")["label"] == 0).all()
    assert (rows_of(same_segment, period="2024-04", time_band="night")["label"] == 0).all()


def test_date_only_incident_is_never_positive_and_blocks_negatives_for_the_month(tmp_path):
    result = build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30, occurred_at="2024-03-05")], [win()])
    data = obs(result)
    assert (data["label"] == 1).sum() == 0
    march_seg0 = rows_of(data, segment_key="delhi-seg-0", period="2024-03")
    assert march_seg0.empty                                             # all 4 bands left unlabelled
    assert result.manifest["observations"]["unlabelledByReason"]["unlabelled_incident_time_of_day_unknown"] == 4
    assert result.manifest["incidents"]["byDecision"] == {"unresolved_time_of_day_unknown": 1}


# ---- duplicates -----------------------------------------------------------------------------------------------

def test_same_incident_id_twice_creates_one_label(tmp_path):
    result = build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30), inc("delhi", 75, 30)], [win()])
    assert result.manifest["ingestion"]["rejectedRows"] == {"duplicate_incident_id": 1}
    positives = rows_of(obs(result), label=1)
    assert len(positives) == 1 and positives.iloc[0]["incident_count"] == 1


def test_cross_source_duplicate_is_one_event_with_a_traceable_link(tmp_path):
    # same event reported by the police (23:10) and by a user (23:40): one positive, one row, count 1
    police = inc("delhi", 75, 10, incident_id="p1", source="police", occurred_at="2024-03-05T23:10:00+05:30")
    report = inc("delhi", 75, 25, incident_id="u1", source="user_report", occurred_at="2024-03-05T23:40:00+05:30")
    result = build(tmp_path, seg_rows("delhi"), [police, report], [win()])
    positives = rows_of(obs(result), label=1)
    assert len(positives) == 1 and positives.iloc[0]["incident_count"] == 1 and positives.iloc[0]["incident_ids"] == "p1"
    decisions = pd.read_csv(result.dataset_dir / "incident_decisions.csv", keep_default_na=False).set_index("incident_id")
    assert decisions.loc["u1", "decision"] == "excluded_duplicate" and decisions.loc["u1", "duplicate_of"] == "police:p1"
    assert decisions.loc["p1", "decision"] == "positive_eligible"
    assert result.manifest["incidents"]["byDecision"] == {"positive_eligible": 1, "excluded_duplicate": 1}


def test_similar_reports_outside_the_dedupe_thresholds_are_distinct_events(tmp_path):
    base = dict(source="police", occurred_at="2024-03-05T23:10:00+05:30")
    too_far = inc("delhi", 75, 80, incident_id="far", **dict(base, source="user_report"))     # 70 m apart > 50 m
    other_category = inc("delhi", 75, 12, incident_id="cat", category="theft", **dict(base, source="user_report"))
    first = inc("delhi", 75, 10, incident_id="p1", **base)
    result = build(tmp_path, seg_rows("delhi"), [first, too_far, other_category], [win()])
    assert result.manifest["incidents"]["byDecision"] == {"positive_eligible": 3}
    assert rows_of(obs(result), label=1).iloc[0]["incident_count"] == 3


def test_distinct_events_in_same_row_are_counted_separately(tmp_path):
    first = inc("delhi", 75, 10, incident_id="a", occurred_at="2024-03-05T22:30:00+05:30")
    second = inc("delhi", 75, 10, incident_id="b", occurred_at="2024-03-06T03:00:00+05:30")
    positives = rows_of(obs(build(tmp_path, seg_rows("delhi"), [first, second], [win()])), label=1)
    assert len(positives) == 1 and positives.iloc[0]["incident_count"] == 2
    assert set(positives.iloc[0]["incident_ids"].split(";")) == {"a", "b"}


# ---- invalid input --------------------------------------------------------------------------------------------

def test_missing_or_invalid_incident_coordinates_never_become_labels(tmp_path):
    bad = [inc("delhi", 75, 30, incident_id="b1", lat="", lon=""), inc("delhi", 75, 30, incident_id="b2", lat="abc"),
           inc("delhi", 75, 30, incident_id="b3", lat="95.0"), inc("delhi", 75, 30, incident_id="b4", lat="0", lon="0"),
           inc("delhi", 75, 30, incident_id="b5", lat="10.0", lon="10.0"),
           inc("delhi", 75, 30, incident_id="b6", lat="nan", lon="77.2")]
    result = build(tmp_path, seg_rows("delhi"), bad + [inc("delhi", 475, 30, incident_id="ok")], [win()])
    rejected = result.manifest["ingestion"]["rejectedRows"]
    assert rejected["missing_or_invalid_coordinates"] == 5 and rejected["outside_configured_cities"] == 1
    assert list(rows_of(obs(result), label=1)["incident_ids"]) == ["ok"]
    assert result.manifest["incidents"]["loaded"] == 1


def test_bad_segments_are_excluded_with_reasons_and_never_labelled(tmp_path):
    segments = seg_rows("delhi")
    segments += [dict(seg_rows("delhi", n=1, prefix="nogeom")[0], geometry_wkt=""),
                 dict(seg_rows("delhi", n=1, prefix="badwkt")[0], geometry_wkt="LINESTRING (oops)"),
                 dict(seg_rows("delhi", n=1, prefix="point")[0], geometry_wkt="POINT (77.2 28.6)"),
                 dict(seg_rows("delhi", n=1, prefix="nolat")[0], mid_lat=np.nan),
                 dict(seg_rows("delhi", n=1, prefix="short")[0], is_short=True),
                 dict(seg_rows("delhi", n=1, prefix="city")[0], cityId="atlantis"),
                 dict(segments[0])]                                           # duplicate key
    result = build(tmp_path, segments, [inc("delhi", 75, 30)], [win()])
    reasons = result.manifest["inputs"]["segmentExclusions"]
    assert reasons == {"unknown_city": 1, "duplicate_segment_key": 1, "invalid_midpoint_coordinates": 1,
                       "invalid_or_missing_geometry": 3, "short_segment": 1}
    exclusions = pd.read_csv(result.dataset_dir / "segment_exclusions.csv")
    assert len(exclusions) == 7
    assert not any(k.split("-")[-2] in {"nogeom", "badwkt", "point", "nolat", "short"} for k in obs(result)["segment_key"])


# ---- unresolved and excluded incident states ------------------------------------------------------------------

def test_pending_blocks_nearby_negatives_but_rejected_does_not(tmp_path):
    pending = inc("delhi", 2 * 400 + 75, 10, incident_id="pend", verification="unverified")
    rejected = inc("delhi", 3 * 400 + 75, 10, incident_id="rej", verification="rejected")
    result = build(tmp_path, seg_rows("delhi"), [pending, rejected], [win()])
    data = obs(result)
    assert (data["label"] == 1).sum() == 0                                         # neither is a positive
    cell = lambda seg: rows_of(data, segment_key=f"delhi-seg-{seg}", period="2024-03", time_band="night")
    assert cell(2).empty                                                           # pending: left unlabelled
    assert list(cell(3)["label"]) == [0]                                           # rejected: no effect
    assert result.manifest["observations"]["unlabelledByReason"]["unlabelled_pending_incident_nearby"] == 1
    assert result.manifest["incidents"]["byDecision"] == {"unresolved_pending": 1, "excluded_rejected": 1}


def test_out_of_scope_category_has_no_effect(tmp_path):
    config = replace(RiskConfig(), incident_categories=("harassment",))
    result = build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30, category="theft")], [win()], config)
    data = obs(result)
    assert (data["label"] == 1).sum() == 0 and result.manifest["incidents"]["byDecision"] == {"excluded_category_out_of_scope": 1}
    assert not rows_of(data, segment_key="delhi-seg-0", period="2024-03", time_band="night").empty


def test_sos_alarms_are_never_incidents(tmp_path):
    sos = inc("delhi", 75, 30, incident_id="sos1", source="sos", verification="verified")
    result = build(tmp_path, seg_rows("delhi"), [sos], [win()])
    assert result.manifest["ingestion"]["rejectedRows"] == {"unknown_source": 1}
    assert result.manifest["incidents"]["loaded"] == 0 and (obs(result)["label"] == 1).sum() == 0
    mongomock = pytest.importorskip("mongomock")
    db = mongomock.MongoClient().db
    for forbidden in ("sos", "SOS", "activities", ""):
        with pytest.raises(ValueError):
            BackendIncidentSource.from_database(db, forbidden)


def test_location_uncertainty_guard_band_and_unknown_error(tmp_path):
    config = RiskConfig()
    near_boundary = inc("delhi", 75, 130, incident_id="g", location_error_m="50")      # 100 < 130 <= 150
    far_enough = inc("delhi", 400 + 75, 210, incident_id="f", location_error_m="50")   # 210 > 150: segment 1 clean
    result = build(tmp_path, seg_rows("delhi"), [near_boundary, far_enough], [win()], config)
    data = obs(result)
    cell = lambda seg: rows_of(data, segment_key=f"delhi-seg-{seg}", period="2024-03", time_band="night")
    assert cell(0).empty and list(cell(1)["label"]) == [0]
    assert (data["label"] == 1).sum() == 0
    assert result.manifest["observations"]["unlabelledByReason"]["unlabelled_location_guard_band"] == 1


def test_unknown_or_oversized_location_error_is_unresolved_not_positive(tmp_path):
    unknown = inc("delhi", 75, 30, incident_id="u", location_error_m="")
    large = inc("delhi", 4 * 400 + 75, 30, incident_id="l", location_error_m="150", occurred_at="2024-07-05T10:00:00+05:30")
    result = build(tmp_path, seg_rows("delhi"), [unknown, large], [win()])
    data = obs(result)
    assert (data["label"] == 1).sum() == 0
    # unknown error cannot be bounded: the whole city is unlabelled for that month and band (6 segments)
    assert rows_of(data, period="2024-03", time_band="night").empty
    assert len(rows_of(data, period="2024-03", time_band="day")) == 6
    # error 150 > R: taints segments within R + 150 = 250 m (segment 4 only here), not the others
    july_day = rows_of(data, period="2024-07", time_band="day")
    assert len(july_day) == 5 and "delhi-seg-4" not in set(july_day["segment_key"])
    assert result.manifest["incidents"]["byDecision"] == {"unresolved_location_uncertain": 2}


def test_nearest_mode_labels_one_segment_and_leaves_the_rest_unlabelled(tmp_path):
    segments = seg_rows("delhi", n=1, prefix="a") + seg_rows("delhi", n=1, prefix="b", north=60.0)
    incident = inc("delhi", 75, 20)                                         # 20 m from a, 40 m from b
    radius = build(tmp_path, segments, [incident], [win()], name="radius")
    nearest = build(tmp_path, segments, [incident], [win()], replace(RiskConfig(), match_mode="nearest"), name="nearest")
    assert set(rows_of(obs(radius), label=1)["segment_key"]) == {"delhi-a-0", "delhi-b-0"}
    data = obs(nearest)
    assert set(rows_of(data, label=1)["segment_key"]) == {"delhi-a-0"}
    assert rows_of(data, segment_key="delhi-b-0", period="2024-03", time_band="night").empty
    assert nearest.manifest["observations"]["unlabelledByReason"]["unlabelled_location_guard_band"] == 1


# ---- audit, determinism, independence from infrastructure ------------------------------------------------------

def test_every_decision_is_audited_with_provenance(tmp_path):
    verified = inc("delhi", 75, 30, incident_id="v", verified_by="admin-1", verified_at="2024-03-07T10:00:00Z",
                   submitted_at="2024-03-06T09:00:00Z")
    pending = inc("delhi", 400 + 75, 30, incident_id="p", verification="unverified")
    result = build(tmp_path, seg_rows("delhi"), [verified, pending], [win()])
    decisions = pd.read_csv(result.dataset_dir / "incident_decisions.csv", keep_default_na=False)
    assert set(decisions["incident_id"]) == {"v", "p"}
    v = decisions.set_index("incident_id").loc["v"]
    assert v["verified_by"] == "admin-1" and v["verified_at"] == "2024-03-07T10:00:00Z" and v["source_file"] == "incidents.csv"
    assert v["positive_segments"] == 1 and v["positive_segments_in_complete_coverage"] == 1 and v["decision_reason"]
    matches = pd.read_csv(result.dataset_dir / "incident_matches.csv")
    assert set(matches["effect"]) == {"positive", "taint_pending"}
    manifest = json.loads((result.dataset_dir / "manifest.json").read_text())
    assert manifest["inputs"]["road_features_csv"] and "incidents.csv" in manifest["inputs"]["incident_files"]
    assert (result.dataset_dir / "BUILD_REPORT.md").read_text().startswith("# Dataset build")


def test_labels_do_not_depend_on_infrastructure_features(tmp_path):
    base = seg_rows("delhi")
    rich = [dict(r, police_count=99, hospital_count=9, pharmacy_count=9, shop_count=500, establishment_density_per_km2=9999.0,
                 police_nearest_m=1.0) for r in base]
    poor = [dict(r, police_count=0, hospital_count=0, pharmacy_count=0, shop_count=0, establishment_density_per_km2=0.0,
                 police_nearest_m=9000.0) for r in base]
    a = obs(build(tmp_path, rich, [inc("delhi", 75, 30)], [win()], name="rich"))
    b = obs(build(tmp_path, poor, [inc("delhi", 75, 30)], [win()], name="poor"))
    assert list(a["observation_id"]) == list(b["observation_id"]) and list(a["label"]) == list(b["label"])
    assert set(rows_of(a, label=1)["segment_key"]) == {"delhi-seg-0"}           # infrastructure-rich road still positive
    assert (rows_of(b, label=0)["police_count"] == 0).all()                    # infrastructure-poor roads are not "unsafe"


def test_rebuild_is_deterministic_and_picks_up_new_verified_reports(tmp_path):
    segments, windows = seg_rows("delhi"), [win()]
    first = build(tmp_path, segments, [inc("delhi", 75, 30)], windows, name="one")
    again = build(tmp_path, segments, [inc("delhi", 75, 30)], windows, name="two")
    assert first.manifest["datasetId"] == again.manifest["datasetId"]
    assert (first.dataset_dir / "observations.csv").read_bytes() == (again.dataset_dir / "observations.csv").read_bytes()
    more = build(tmp_path, segments, [inc("delhi", 75, 30), inc("delhi", 875, 30, incident_id="t2")], windows, name="three")
    assert more.manifest["datasetId"] != first.manifest["datasetId"]
    assert (obs(more)["label"] == 1).sum() == 2


# ---- zero incidents, synthetic marker, cities, trainability ----------------------------------------------------

def test_zero_incidents_reports_that_no_real_dataset_exists(tmp_path):
    for name, windows in (("with-window", [win()]), ("no-window", [])):
        result = build(tmp_path, seg_rows("delhi"), [], windows, name=name)
        assert result.trainable is False and result.manifest["observations"]["rowsWritten"] == 0
        assert any("No real training dataset" in b for b in result.manifest["blockers"])
        assert "No real training dataset is available" in (result.dataset_dir / "BUILD_REPORT.md").read_text()
        assert len(obs(result)) == 0
    assert result.manifest["coverageWindows"] == []
    first = build(tmp_path, seg_rows("delhi"), [], [win()], name="w")
    assert first.manifest["coverageWindows"][0]["usable"] is False        # declared complete, but no records delivered


def test_missing_incident_directory_and_missing_features_file(tmp_path):
    features = tmp_path / "f.csv"
    pd.DataFrame(seg_rows("delhi")).to_csv(features, index=False)
    result = build_dataset(features, FileIncidentSource(tmp_path / "does-not-exist"), tmp_path / "out")
    assert result.trainable is False and result.manifest["observations"]["rowsWritten"] == 0
    with pytest.raises(DatasetBuildError, match="not found"):
        build_dataset(tmp_path / "none.csv", FileIncidentSource(tmp_path), tmp_path / "out")
    pd.DataFrame([{"x": 1}]).to_csv(tmp_path / "bad.csv", index=False)
    with pytest.raises(DatasetBuildError, match="missing required columns"):
        build_dataset(tmp_path / "bad.csv", FileIncidentSource(tmp_path), tmp_path / "out")


def test_synthetic_marker_blocks_training_and_cannot_mix_with_real(tmp_path):
    lenient = RiskConfig(min_total_positives=1, min_positives_per_city=1, min_cities_with_labels=1, min_negative_rows=1)
    synthetic = build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30, incident_id="SYNTHETIC-1")], [win()], lenient, "syn")
    assert synthetic.manifest["isSynthetic"] and synthetic.manifest["dataOrigin"] == "synthetic" and not synthetic.trainable
    assert set(obs(synthetic)["data_origin"]) == {"synthetic"}
    assert (synthetic.dataset_dir.parent / "latest_synthetic.json").exists() and not (synthetic.dataset_dir.parent / "latest.json").exists()
    with pytest.raises(NotTrainableError):
        require_trainable(synthetic.manifest)
    with pytest.raises(DatasetBuildError, match="mix"):
        build(tmp_path, seg_rows("delhi"), [inc("delhi", 75, 30, incident_id="SYNTHETIC-1"), inc("delhi", 475, 30, incident_id="r2")],
              [win()], name="mixed")


def test_three_builtin_cities_and_trainability_gate(tmp_path):
    cities = ("jalandhar", "bathinda", "delhi")
    segments = [r for c in cities for r in seg_rows(c)]
    incidents = [inc(c, 75, 30, incident_id=f"{c}-1") for c in cities]
    windows = [win(c) for c in cities]
    default = build(tmp_path, segments, incidents, windows, name="default")
    assert default.trainable is False and any("Only 3 usable incidents" in b for b in default.manifest["blockers"])
    with pytest.raises(NotTrainableError):
        require_trainable(default.manifest)
    lenient = RiskConfig(min_total_positives=3, min_positives_per_city=1, min_cities_with_labels=3, min_negative_rows=100)
    ok = build(tmp_path, segments, incidents, windows, lenient, "lenient")
    assert ok.trainable is True and ok.manifest["blockers"] == [] and require_trainable(ok.manifest) is None
    positives = rows_of(obs(ok), label=1)
    assert set(positives["city_id"]) == set(cities) and len(positives) == 3
    assert ok.manifest["observations"]["positivesByCityTrainingEligible"] == {c: 1 for c in cities}


def test_incident_is_matched_only_within_its_own_city(tmp_path):
    segments = seg_rows("delhi") + seg_rows("jalandhar")
    result = build(tmp_path, segments, [inc("delhi", 75, 30)], [win(), win("jalandhar")])
    positives = rows_of(obs(result), label=1)
    assert set(positives["city_id"]) == {"delhi"}
    assert result.manifest["perCity"]["jalandhar"]["note"].startswith("no incident records")


def test_dynamic_city_end_to_end_through_the_cli(tmp_path):
    cities = tmp_path / "cities.json"
    cities.write_text(json.dumps({"cities": [{"id": "testpur", "name": "Testpur", "state": "Rajasthan",
                                              "bbox": {"south": 26.85, "west": 75.75, "north": 26.95, "east": 75.85}}]}))
    script = (
        "import json,sys; sys.path.insert(0, %r); from tests.test_risk_dataset import *\n"
        "import pandas as pd\n"
        "from safira_ml.cli import main\n"
        "root = Path(%r); (root/'inc').mkdir()\n"
        "pd.DataFrame(seg_rows('testpur')).to_csv(root/'f.csv', index=False)\n"
        "pd.DataFrame([inc('testpur', 75, 30, incident_id='d1')]).to_csv(root/'inc'/'i.csv', index=False)\n"
        "(root/'inc'/'coverage.json').write_text(json.dumps({'windows': [win('testpur')]}))\n"
        "code = main(['build-dataset', '--features', str(root/'f.csv'), '--dir', str(root/'inc'), '--out', str(root/'out')])\n"
        "print('EXIT', code)\n") % (str(ML_SERVICE_DIR), str(tmp_path / "dyn"))
    (tmp_path / "dyn").mkdir()
    env = {**os.environ, "SAFIRA_CITIES_FILE": str(cities), "PYTHONPATH": str(ML_SERVICE_DIR)}
    proc = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, env=env, cwd=ML_SERVICE_DIR)
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert "EXIT 3" in proc.stdout                                         # built fine, but too little data to train
    manifest = json.loads(next((tmp_path / "dyn" / "out").glob("dataset_*/manifest.json")).read_text())
    assert manifest["observations"]["positive"] == 1 and manifest["perCity"]["testpur"]["segments"] == 6


def test_cli_exit_codes_and_empty_state(tmp_path, capsys):
    features = tmp_path / "f.csv"
    pd.DataFrame(seg_rows("delhi")).to_csv(features, index=False)
    code = cli_main(["build-dataset", "--features", str(features), "--dir", str(tmp_path / "none"), "--out", str(tmp_path / "out")])
    assert code == 3 and "TRAINABLE: NO" in capsys.readouterr().out
    assert cli_main(["build-dataset", "--features", str(tmp_path / "missing.csv"), "--dir", str(tmp_path), "--out", str(tmp_path)]) == 2


# ---- backend-contract adapter ---------------------------------------------------------------------------------

def test_backend_adapter_maps_contract_statuses_utc_and_provenance(tmp_path):
    from datetime import datetime
    lon, lat = offset("delhi", 75, 30)
    base = {"_id": "r1", "type": "harassment", "location": {"coordinates": [lon, lat]},
            "incidentAt": datetime(2024, 3, 5, 18, 0), "verificationStatus": "VERIFIED",   # naive BSON datetime = UTC
            "verifiedBy": "admin-9", "verifiedAt": datetime(2024, 3, 6, 8, 0), "submittedAt": datetime(2024, 3, 5, 18, 30),
            "locationAccuracyM": 20, "description": "free text that must not be carried"}
    docs = [base,
            dict(base, _id="r2", verificationStatus="PENDING"),
            dict(base, _id="r3", verificationStatus="REJECTED", rejectedBy="admin-2"),
            dict(base, _id="r4", verificationStatus="APPROVED?"),
            {k: v for k, v in dict(base, _id="r5").items() if k != "location"}]
    raw, mapping = map_backend_documents(docs)
    assert mapping["mappingFailures"] == {"mapping_missing_field:lat": 1}
    source = BackendIncidentSource.from_documents(docs, label="test")
    clean, report = source.load()
    assert report["rejected"]["invalid_verification_value"] == 1 and "description" not in clean.columns
    r1 = clean.set_index("incident_id").loc["r1"]
    assert str(r1["occurred_at_utc"]) == "2024-03-05 18:00:00+00:00" and r1["occurred_local"].hour == 23   # 18:00Z is 23:30 IST
    assert r1["verified_by"] == "admin-9" and r1["source"] == "user_report"
    assert set(clean["verification"]) == {"verified", "unverified", "rejected"}

    features = tmp_path / "f.csv"
    pd.DataFrame(seg_rows("delhi")).to_csv(features, index=False)
    result = build_dataset(features, source, tmp_path / "out", windows=parse_coverage({"windows": [win(source="user_report")]}))
    positives = rows_of(obs(result), label=1)
    assert list(positives["incident_ids"]) == ["r1"] and list(positives["time_band"]) == ["night"]
    # r2 (pending, same place/time) is a duplicate of r1 and r3 (rejected) is ignored: neither adds counts
    assert result.manifest["incidents"]["byDecision"] == {"positive_eligible": 1, "excluded_duplicate": 1, "excluded_rejected": 1}


def test_backend_adapter_reads_a_named_collection_via_mongomock(tmp_path):
    mongomock = pytest.importorskip("mongomock")
    lon, lat = offset("delhi", 75, 30)
    db = mongomock.MongoClient().safira_test
    db["incident_reports"].insert_one({"incidentId": "m1", "category": "stalking", "latitude": lat, "longitude": lon,
                                       "occurredAt": "2024-03-05T23:30:00+05:30", "status": "VERIFIED", "gpsAccuracy": 25})
    stored = db["incident_reports"].find_one({})["_id"]
    clean, _ = BackendIncidentSource.from_database(db, "incident_reports").load()
    assert list(clean["incident_id"]) == [str(stored)] and clean.iloc[0]["verification"] == "verified"
    with pytest.raises(ValueError, match="explicitly"):
        BackendIncidentSource.from_database(db, "  ")


def test_field_map_overrides_candidate_names():
    docs = [{"rid": "x", "kind": "theft", "y": 28.64, "x": 77.21, "when": "2024-03-05T23:30:00+05:30", "state": "PENDING"}]
    raw, mapping = map_backend_documents(docs, {"incident_id": "rid", "category": "kind", "lat": "y", "lon": "x",
                                                "occurred_at": "when", "verification": "state"})
    assert mapping["mappingFailures"] == {} and raw.iloc[0]["verification"] == "unverified"
