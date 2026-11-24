"""Incident ingestion tests. All rows are SYNTHETIC test fixtures (never stored anywhere)."""
import json

import pandas as pd
import pytest

from safira_ml.risk.config import RiskConfig
from safira_ml.risk.coverage import CoverageError, covering_window, parse_coverage
from safira_ml.risk.incidents import IncidentFileError, load_incident_dir, validate_incidents
from safira_ml.risk.inspect import inspect_incident_data, trainability_blockers

DELHI = (28.64, 77.21)


def row(**kw):
    base = {"incident_id": "1", "source": "police", "category": "harassment", "occurred_at": "2024-03-05T23:30:00+05:30",
            "lat": str(DELHI[0]), "lon": str(DELHI[1]), "verification": "verified", "location_error_m": "30",
            "source_ref": "fir-1"}
    base.update(kw)
    return base


def frame(*rows):
    return pd.DataFrame(list(rows))


def test_valid_row_kept_and_assigned_to_city_with_local_time():
    clean, report = validate_incidents(frame(row()))
    assert report["rowsKept"] == 1 and report["rejected"] == {}
    r = clean.iloc[0]
    assert r["city_id"] == "delhi" and r["occurred_local"].hour == 23 and bool(r["time_known"])


@pytest.mark.parametrize("kw,reason", [
    ({"source": "tweet"}, "unknown_source"),
    ({"verification": "maybe"}, "invalid_verification_value"),
    ({"category": "weird thing"}, "unmapped_category"),
    ({"lat": "", "lon": ""}, "missing_or_invalid_coordinates"),
    ({"lat": "0", "lon": "0"}, "missing_or_invalid_coordinates"),
    ({"lat": "10.0", "lon": "10.0"}, "outside_configured_cities"),
    ({"occurred_at": "not a date"}, "missing_or_invalid_time"),
    ({"occurred_at": ""}, "missing_or_invalid_time"),
    ({"incident_id": ""}, "missing_incident_id"),
    ({"location_error_m": "-5"}, "invalid_location_error"),
    ({"city_id": "jalandhar"}, "city_id_disagrees_with_coordinates"),
])
def test_bad_rows_are_rejected_with_a_reason_never_repaired(kw, reason):
    clean, report = validate_incidents(frame(row(**kw)))
    assert len(clean) == 0 and report["rejected"] == {reason: 1}


def test_category_map_maps_source_labels_but_unmapped_stay_rejected():
    clean, report = validate_incidents(frame(row(category="Eve Teasing"), row(incident_id="2", category="Cyber fraud")),
                                       category_map={"eve teasing": "harassment"})
    assert list(clean["category"]) == ["harassment"] and report["rejected"] == {"unmapped_category": 1}


def test_duplicates_naive_time_date_only_and_unknown_error_are_flagged_not_hidden():
    clean, report = validate_incidents(frame(
        row(), row(),                                                    # duplicate id
        row(incident_id="2", occurred_at="2024-03-06"),                   # date only
        row(incident_id="3", occurred_at="2024-03-07 10:00:00"),          # naive timestamp
        row(incident_id="4", location_error_m="")))                       # unknown error
    assert report["rejected"] == {"duplicate_incident_id": 1}
    assert report["dateOnlyRows"] == 1 and report["assumedTimezoneRows"] == 2 and report["unknownLocationErrorRows"] == 1
    assert clean.loc[clean.incident_id == "3", "occurred_local"].iloc[0].hour == 10


def test_missing_required_column_is_a_file_error():
    with pytest.raises(IncidentFileError, match="lat"):
        validate_incidents(frame(row()).drop(columns=["lat"]))


def test_coverage_requires_explicit_complete_flag_and_fine_geocoding():
    good = {"windows": [{"source": "police", "city_id": "delhi", "start": "2024-01-01", "end": "2025-01-01",
                         "complete": True, "location_error_m": 50}]}
    windows = parse_coverage(good)
    start, end = pd.Timestamp("2024-03-01", tz="Asia/Kolkata").tz_convert("UTC"), pd.Timestamp("2024-04-01", tz="Asia/Kolkata").tz_convert("UTC")
    assert covering_window(windows, "delhi", start, end, 100) is not None
    assert covering_window(windows, "delhi", start, end, 20) is None            # geocoding too coarse
    assert covering_window(windows, "jalandhar", start, end, 100) is None        # other city
    assert covering_window(windows, "delhi", start, pd.Timestamp("2026-01-01", tz="UTC"), 100) is None  # not fully covered
    for bad in [{"windows": [dict(good["windows"][0], complete="yes")]},
                {"windows": [dict(good["windows"][0], city_id="atlantis")]},
                {"windows": [dict(good["windows"][0], start="2025-02-01")]}]:
        with pytest.raises(CoverageError):
            parse_coverage(bad)


def test_blockers_are_listed_when_data_is_missing_and_empty_when_gate_is_met():
    cfg = RiskConfig()
    assert len(trainability_blockers({}, [], cfg)) == 3
    window = parse_coverage({"windows": [{"source": "police", "city_id": "delhi", "start": "2023-01-01", "end": "2025-01-01",
                                          "complete": True, "location_error_m": 50}]})
    assert trainability_blockers({"delhi": 300, "jalandhar": 40}, window, cfg) == []
    assert any("held out" in b for b in trainability_blockers({"delhi": 300}, window, cfg))


def test_inspect_empty_and_populated_directory(tmp_path):
    empty = inspect_incident_data(tmp_path / "missing")
    assert empty["trainable"] is False and empty["usableIncidents"] == 0 and not empty["directoryExists"]

    pd.DataFrame([row(), row(incident_id="2", verification="unverified"), row(incident_id="3", occurred_at="2024-03-06")]
                 ).to_csv(tmp_path / "police.csv", index=False)
    (tmp_path / "coverage.json").write_text(json.dumps({"windows": []}), encoding="utf-8")
    report = inspect_incident_data(tmp_path)
    assert report["rowsKept"] == 3 and report["usableIncidents"] == 1
    assert report["whyRowsAreNotUsable"]["not_verified"] == 1 and report["whyRowsAreNotUsable"]["time_of_day_unknown"] == 1
    assert report["trainable"] is False


def test_load_incident_dir_dedupes_across_files_and_reports_file_errors(tmp_path):
    pd.DataFrame([row()]).to_csv(tmp_path / "a.csv", index=False)
    pd.DataFrame([row()]).to_csv(tmp_path / "b.csv", index=False)
    pd.DataFrame([{"x": 1}]).to_csv(tmp_path / "c.csv", index=False)
    frame_, report = load_incident_dir(tmp_path)
    assert len(frame_) == 1 and report["rejected"]["duplicate_across_files"] == 1
    assert "missing required columns" in report["files"]["c.csv"]["error"]
