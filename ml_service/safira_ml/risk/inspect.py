"""Report what incident data exists and exactly what is missing before a model can be trained."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import pandas as pd

from .config import INCIDENT_DIR, RiskConfig
from .coverage import CoverageError, CoverageWindow, load_coverage
from .incidents import load_incident_dir

DISCLAIMER = ("Incident counts describe RECORDED incidents only. Recording is biased (under-reporting, "
              "police-station proximity, population exposure). A missing record is not proof of safety.")


def trainability_blockers(usable_counts: dict, windows: list[CoverageWindow], config: RiskConfig) -> list[str]:
    """Plain-language list of what still blocks training. Empty list = the data gate is satisfied."""
    blockers = []
    total = sum(usable_counts.values())
    if total == 0:
        blockers.append("No usable incidents: need verified, geolocated, time-stamped records "
                        f"(location error <= {config.label_radius_m:.0f} m).")
    elif total < config.min_total_positives:
        blockers.append(f"Only {total} usable incidents; need at least {config.min_total_positives}.")
    cities_ok = [c for c, n in usable_counts.items() if n >= config.min_positives_per_city]
    if len(cities_ok) < config.min_cities_with_labels:
        blockers.append(f"Need >= {config.min_cities_with_labels} cities with >= {config.min_positives_per_city} usable incidents "
                        f"(have {len(cities_ok)}) so a city can be held out for testing.")
    complete = [w for w in windows if w.complete and w.location_error_m <= config.label_radius_m]
    if not complete:
        blockers.append("No 'complete' coverage window in coverage.json: without it no segment/period may be labelled 0 "
                        "(a missing record is not proof that nothing happened).")
    return blockers


def inspect_incident_data(directory: Optional[Path] = None, config: Optional[RiskConfig] = None) -> dict:
    config = config or RiskConfig()
    directory = Path(directory or INCIDENT_DIR)
    frame, load_report = load_incident_dir(directory, config)
    coverage_error = None
    try:
        windows = load_coverage(directory)
    except CoverageError as exc:
        windows, coverage_error = [], str(exc)

    usable_mask = pd.Series(False, index=frame.index)
    if len(frame):
        usable_mask = ((frame["verification"] == "verified") & frame["time_known"]
                       & (frame["location_error_m"] <= config.label_radius_m)
                       & frame["category"].isin(config.incident_categories))
    usable = frame[usable_mask]
    usable_counts = usable.groupby("city_id").size().to_dict() if len(usable) else {}

    def counts(column):
        return {str(k): int(v) for k, v in frame[column].value_counts().items()} if len(frame) else {}

    why_not_usable = {}
    if len(frame):
        why_not_usable = {
            "not_verified": int((frame["verification"] != "verified").sum()),
            "time_of_day_unknown": int((~frame["time_known"]).sum()),
            "location_error_unknown_or_too_large": int((~(frame["location_error_m"] <= config.label_radius_m)).sum()),
            "category_not_in_scope": int((~frame["category"].isin(config.incident_categories)).sum()),
        }
    blockers = trainability_blockers(usable_counts, windows, config)
    return {
        "directory": str(directory), "directoryExists": directory.is_dir(),
        "files": load_report["files"], "rejectedRows": load_report["rejected"],
        "rowsKept": int(len(frame)), "usableIncidents": int(len(usable)),
        "usableByCity": {k: int(v) for k, v in usable_counts.items()},
        "bySource": counts("source"), "byCity": counts("city_id"), "byCategory": counts("category"),
        "byVerification": counts("verification"), "whyRowsAreNotUsable": why_not_usable,
        "dateRange": ([str(frame["occurred_at_utc"].min()), str(frame["occurred_at_utc"].max())] if len(frame) else None),
        "coverageWindows": [{"source": w.source, "cityId": w.city_id, "start": str(w.start), "end": str(w.end),
                             "complete": w.complete, "locationErrorM": w.location_error_m} for w in windows],
        "coverageError": coverage_error,
        "trainable": not blockers and coverage_error is None,
        "blockers": blockers + ([f"coverage.json invalid: {coverage_error}"] if coverage_error else []),
        "disclaimer": DISCLAIMER,
    }


def render_text(report: dict) -> str:
    lines = [f"Incident data directory: {report['directory']} ({'found' if report['directoryExists'] else 'NOT FOUND'})"]
    if not report["files"]:
        lines.append("  no incident files (*.csv / *.jsonl) found")
    for name, info in report["files"].items():
        lines.append(f"  {name}: " + (info["error"] if "error" in info else
                                       f"{info['rowsRead']} rows read, {info['rowsKept']} valid"))
    if report["rejectedRows"]:
        lines.append("Rejected rows by reason: " + ", ".join(f"{k}={v}" for k, v in report["rejectedRows"].items()))
    lines += [f"Valid rows: {report['rowsKept']}   Usable for labels: {report['usableIncidents']}",
              f"Usable by city: {report['usableByCity'] or 'none'}",
              f"Coverage windows: {len(report['coverageWindows'])}"]
    lines.append("TRAINABLE: " + ("yes" if report["trainable"] else "NO"))
    for blocker in report["blockers"]:
        lines.append(f"  - {blocker}")
    lines.append(report["disclaimer"])
    return "\n".join(lines)
