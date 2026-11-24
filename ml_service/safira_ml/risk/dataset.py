"""Supervised dataset builder (P3): road_features.csv + incident source + coverage manifest -> labelled rows.

    build_dataset(features_csv, source) writes, into ``<out>/dataset_<id>/``:

      observations.csv        one row per labelled (segment, month, time band): label 0/1 (see labels.py)
      incident_decisions.csv  EVERY loaded incident with its decision, reason, duplicate link, provenance
      incident_matches.csv    EVERY incident x segment spatial match with distance and effect
      segment_exclusions.csv  segments that could not be used and why
      manifest.json           inputs (sha256), parameters, coverage windows used/rejected, counts, trainability
      BUILD_REPORT.md         the same in plain language

Nothing here trains a model, touches K-Means, route scoring or the database. The build is deterministic: the
same inputs give the same ``dataset_id`` and byte-identical files; new verified reports are picked up simply by
running it again (a new id is produced).
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from ..config import CITY_BOUNDING_BOXES, PIPELINE_VERSION, RAW_FEATURE_COLUMNS, SUPPORTED_CITIES, data_dir
from .adapters import IncidentSource
from .config import MATCH_MODES, RiskConfig
from .coverage import CoverageWindow
from .inspect import DISCLAIMER
from .labels import (ACTIVE, D_POSITIVE, R_NEGATIVE, R_POSITIVE, UNLABELLED_PRIORITY, U_UNCOVERED, audit_windows,
                     classify_incidents, dataset_trainability, run_city)
from .matching import (assign_time_buckets, build_segment_index, mark_duplicates, months_between,
                       parse_segment_geometry, period_bounds_utc)

BUILDER_VERSION = "1.0.0"
REQUIRED_SEGMENT_COLUMNS = ("segment_key", "cityId", "mid_lat", "mid_lon", "geometry_wkt")
# Carried unchanged from road_features.csv (missing values stay missing; nothing is imputed here).
FEATURE_PASSTHROUGH = (*RAW_FEATURE_COLUMNS, "lit_tag", "road_type", "road_group", "is_short", "near_bbox_edge",
                       "mid_lat", "mid_lon", "extraction_run_id")
SYNTHETIC_PREFIX = "synthetic"      # incident_id or source_ref starting with this marks a TEST record


class DatasetBuildError(ValueError):
    pass


@dataclass
class BuildResult:
    dataset_dir: Path
    manifest: dict

    @property
    def trainable(self) -> bool:
        return bool(self.manifest["trainable"])


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def load_segments(path: Path) -> tuple[pd.DataFrame, dict, list]:
    """Read road_features.csv. Returns (usable segments with parsed geometry, report, exclusion rows)."""
    frame = pd.read_csv(path, low_memory=False)
    missing = [c for c in REQUIRED_SEGMENT_COLUMNS if c not in frame.columns]
    if missing:
        raise DatasetBuildError(f"{path}: missing required columns: {', '.join(missing)}")
    for column in ("is_short", "near_bbox_edge"):
        if column in frame.columns:
            frame[column] = frame[column].astype(str).str.lower().isin(["true", "1"])
        else:
            frame[column] = False
    excluded, reasons = [], Counter()

    def drop(mask, reason):
        for key, city in zip(frame.loc[mask, "segment_key"], frame.loc[mask, "cityId"]):
            excluded.append({"segment_key": key, "city_id": city, "reason": reason})
        if int(mask.sum()):
            reasons[reason] += int(mask.sum())
        return ~mask

    keep = pd.Series(True, index=frame.index)
    keep &= drop(~frame["cityId"].astype(str).isin(SUPPORTED_CITIES), "unknown_city")
    keep &= drop(keep & (frame["segment_key"].isna() | (frame["segment_key"].astype(str).str.strip() == "")),
                 "missing_segment_key")
    keep &= drop(keep & frame.duplicated(subset=["cityId", "segment_key"], keep="first"), "duplicate_segment_key")
    lat = pd.to_numeric(frame["mid_lat"], errors="coerce")
    lon = pd.to_numeric(frame["mid_lon"], errors="coerce")
    bad_mid = ~(np.isfinite(lat) & np.isfinite(lon) & lat.between(-90, 90) & lon.between(-180, 180))
    keep &= drop(keep & bad_mid, "invalid_midpoint_coordinates")
    geoms = frame["geometry_wkt"].map(parse_segment_geometry)
    keep &= drop(keep & geoms.isna(), "invalid_or_missing_geometry")
    return_frame = frame[keep].copy()
    return_frame["_geom"] = geoms[keep]
    return return_frame, {"rowsRead": int(len(frame)), "excluded": dict(reasons)}, excluded


def _hash_inputs(parts: dict) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def _write_csv(frame: pd.DataFrame, path: Path) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    frame.to_csv(temp, index=False, float_format="%.8g")
    temp.replace(path)


def build_dataset(features_csv: Path, source: IncidentSource, out_root: Optional[Path] = None,
                  config: Optional[RiskConfig] = None, windows: Optional[list[CoverageWindow]] = None,
                  built_at: Optional[str] = None) -> BuildResult:
    config = config or RiskConfig()
    if config.period != "month":
        raise DatasetBuildError("only period='month' is implemented")
    if config.match_mode not in MATCH_MODES:
        raise DatasetBuildError(f"match_mode must be one of {MATCH_MODES}")
    features_csv = Path(features_csv)
    if not features_csv.is_file():
        raise DatasetBuildError(f"{features_csv} not found - run `python -m safira_ml.cli extract` first")

    segments, segment_report, segment_exclusions = load_segments(features_csv)
    incidents, ingestion = source.load(config)
    windows = list(windows if windows is not None else source.coverage())

    is_synth = (incidents["incident_id"].str.lower().str.startswith(SYNTHETIC_PREFIX)
                | incidents["source_ref"].str.lower().str.startswith(SYNTHETIC_PREFIX)) if len(incidents) \
        else pd.Series(dtype=bool)
    if len(incidents) and is_synth.any() and not is_synth.all():
        raise DatasetBuildError("refusing to mix SYNTHETIC test incidents with real incident records")
    synthetic = bool(len(incidents) and is_synth.all())
    data_origin = "synthetic" if synthetic else "real"

    incidents = incidents.sort_values(["source", "incident_id"]).reset_index(drop=True)
    incidents = assign_time_buckets(classify_incidents(mark_duplicates(incidents, config), config)) \
        if len(incidents) else incidents.assign(duplicate_of="", decision="", decision_reason="", period="", band="")
    usable, window_audit = audit_windows(windows, incidents, config)

    feature_columns = [c for c in FEATURE_PASSTHROUGH if c in segments.columns]
    missing_features = [c for c in (*RAW_FEATURE_COLUMNS, "lit_tag") if c not in segments.columns]
    short = segments["is_short"].to_numpy()
    if config.exclude_short_segments:
        for key, city in zip(segments.loc[short, "segment_key"], segments.loc[short, "cityId"]):
            segment_exclusions.append({"segment_key": key, "city_id": city, "reason": "short_segment"})
        segment_report["excluded"]["short_segment"] = int(short.sum())
        segments = segments[~short]

    # ---- identity of this dataset ------------------------------------------------------------------------
    incident_digest = incidents.drop(columns=["_geom"], errors="ignore").astype(str).to_csv(index=False)
    input_hashes = {"road_features_csv": _sha256(features_csv),
                    "incidents_clean": hashlib.sha256(incident_digest.encode()).hexdigest(),
                    "incident_files": {p.name: _sha256(p) for p in getattr(source, "input_files", lambda: [])()}}
    dataset_id = _hash_inputs({"v": BUILDER_VERSION, "config": config.to_dict(), "inputs": input_hashes,
                               "windows": [(w.source, w.city_id, str(w.start), str(w.end), w.complete,
                                            w.location_error_m, w.bbox) for w in windows]})[:12]
    out_dir = Path(out_root or data_dir() / "datasets") / f"dataset_{dataset_id}"
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.tmp"):
        stale.unlink()

    # ---- label every city ------------------------------------------------------------------------------
    obs_path = out_dir / "observations.csv"
    obs_path.unlink(missing_ok=True)
    state = {"rows": 0, "first": True}

    def sink(_period, frame):
        frame.to_csv(obs_path, mode="a", header=state["first"], index=False, float_format="%.8g")
        state["first"], state["rows"] = False, state["rows"] + len(frame)

    counts, match_rows, effects = Counter(), [], {}
    positives_by_city, per_city = {}, {}
    cities_in_data = sorted(set(segments["cityId"].astype(str)))
    for city_id in cities_in_data:
        city_segments = segments[segments["cityId"].astype(str) == city_id]
        city_incidents = incidents[incidents["city_id"] == city_id] if len(incidents) else incidents
        city_windows = [u for u in usable if u.window.city_id == city_id]
        spans = []
        if len(city_incidents):
            spans += [(city_incidents["occurred_at_utc"].min(), city_incidents["occurred_at_utc"].max()
                       + pd.Timedelta(microseconds=1))]
        spans += [(u.window.start, u.window.end) for u in city_windows]
        if not spans or not len(city_incidents):
            per_city[city_id] = {"segments": int(len(city_segments)), "horizonMonths": 0,
                                 "note": "no incident records for this city: nothing labelled"}
            continue
        months = months_between(min(s[0] for s in spans), max(s[1] for s in spans), city_id)
        if len(months) > config.max_horizon_months:
            raise DatasetBuildError(f"{city_id}: observation horizon of {len(months)} months exceeds "
                                    f"max_horizon_months={config.max_horizon_months}; check coverage dates")
        index = build_segment_index(city_id, city_segments)
        result = run_city(index, incidents, usable, months, config, feature_columns, data_origin, sink)
        counts.update(result.counts)
        match_rows += result.matches
        effects.update(result.incident_effects)
        positives_by_city[city_id] = int(result.counts["positive_training_eligible"])
        per_city[city_id] = {"segments": int(len(city_segments)), "horizonMonths": len(months),
                             "firstMonth": months[0], "lastMonth": months[-1],
                             **{k: int(v) for k, v in result.counts.items()}}

    # ---- audit tables ------------------------------------------------------------------------------------
    if len(incidents):
        decisions = incidents.drop(columns=["_geom"], errors="ignore").copy()
        keys = decisions["source"] + ":" + decisions["incident_id"]
        for column in ("positive_segments", "positive_segments_in_complete_coverage", "guard_segments",
                       "taint_segments", "citywide_taint"):
            decisions[column] = [int(effects.get(k, {}).get(column, 0)) for k in keys]
        decisions["occurred_at_utc"] = decisions["occurred_at_utc"].astype(str)
        decisions["occurred_local"] = decisions["occurred_local"].astype(str)
        decisions["data_origin"] = data_origin
    else:
        decisions = pd.DataFrame(columns=["incident_id", "source", "decision"])
    _write_csv(decisions, out_dir / "incident_decisions.csv")
    _write_csv(pd.DataFrame(match_rows, columns=["incident_id", "source", "city_id", "segment_key", "distance_m",
                                                 "effect", "period", "time_band", "incident_decision"]),
               out_dir / "incident_matches.csv")
    _write_csv(pd.DataFrame(segment_exclusions, columns=["segment_key", "city_id", "reason"]),
               out_dir / "segment_exclusions.csv")
    if state["first"]:                                    # nothing labelled: still leave a header-only file
        pd.DataFrame(columns=["observation_id", "city_id", "segment_key", "period", "time_band", "label"]
                     ).to_csv(obs_path, index=False)

    decision_counts = decisions["decision"].value_counts().to_dict() if len(decisions) else {}
    blockers = dataset_trainability(dict(counts), positives_by_city, usable, config, synthetic, state["rows"])
    total_unlabelled = int(counts[U_UNCOVERED] + sum(counts[r] for r in UNLABELLED_PRIORITY))
    manifest = {
        "datasetId": dataset_id, "builderVersion": BUILDER_VERSION, "pipelineVersion": PIPELINE_VERSION,
        "builtAt": built_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataOrigin": data_origin, "isSynthetic": synthetic, "incidentSource": source.name,
        "inputs": {**input_hashes, "segmentsRead": segment_report["rowsRead"],
                   "segmentsUsable": int(len(segments)), "segmentExclusions": segment_report["excluded"],
                   "missingFeatureColumns": missing_features},
        "config": config.to_dict(),
        "ingestion": {"rejectedRows": ingestion.get("rejected", {}), "files": ingestion.get("files", {}),
                      **{k: v for k, v in ingestion.items() if k in ("mappingFailures", "documentsMapped", "adapter")}},
        "incidents": {"loaded": int(len(incidents)), "byDecision": {k: int(v) for k, v in decision_counts.items()},
                      "usableAsPositive": int(decision_counts.get(D_POSITIVE, 0))},
        "coverageWindows": window_audit,
        "observations": {"rowsWritten": state["rows"], "positive": int(counts[R_POSITIVE]),
                         "positiveTrainingEligible": int(counts["positive_training_eligible"]),
                         "positiveOutsideCompleteCoverage": int(counts["positive_outside_complete_coverage"]),
                         "negative": int(counts[R_NEGATIVE]), "unlabelled": total_unlabelled,
                         "unlabelledByReason": {r: int(counts[r]) for r in (U_UNCOVERED, *UNLABELLED_PRIORITY)},
                         "positivesByCityTrainingEligible": positives_by_city},
        "perCity": per_city, "trainable": not blockers, "blockers": blockers,
        "files": ["observations.csv", "incident_decisions.csv", "incident_matches.csv", "segment_exclusions.csv",
                  "manifest.json", "BUILD_REPORT.md"],
        "disclaimer": DISCLAIMER + " Labels are 'recorded incident near this segment in this month/time band'; "
                                   "a 0 means 'none recorded in a source declared complete', nothing more.",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")
    (out_dir / "BUILD_REPORT.md").write_text(render_report(manifest), encoding="utf-8")
    pointer = {"datasetId": dataset_id, "path": str(out_dir), "trainable": manifest["trainable"],
               "isSynthetic": synthetic, "builtAt": manifest["builtAt"]}
    (out_dir.parent / ("latest_synthetic.json" if synthetic else "latest.json")).write_text(
        json.dumps(pointer, indent=2), encoding="utf-8")
    return BuildResult(out_dir, manifest)


def render_report(m: dict) -> str:
    o, inc = m["observations"], m["incidents"]
    lines = [f"# Dataset build {m['datasetId']}", "",
             f"- Data origin: **{m['dataOrigin'].upper()}**" + ("  (SYNTHETIC TEST DATA - NEVER TRAIN ON IT)" if m["isSynthetic"] else ""),
             f"- Incident source: `{m['incidentSource']}`   Builder v{m['builderVersion']}   Built {m['builtAt']}",
             f"- **Trainable: {'YES' if m['trainable'] else 'NO'}**"]
    lines += [f"  - {b}" for b in m["blockers"]]
    if not m["trainable"] and o["rowsWritten"] == 0:
        lines += ["", "**No real training dataset is available.** No labelled observations could be produced."]
    lines += ["", "## Incidents", f"- Loaded (after validation): {inc['loaded']}   usable as positive: {inc['usableAsPositive']}"]
    lines += [f"- {k}: {v}" for k, v in sorted(inc["byDecision"].items())]
    rejected = m["ingestion"].get("rejectedRows") or {}
    lines += ["- Rows rejected at ingestion: " + (", ".join(f"{k}={v}" for k, v in rejected.items()) or "none")]
    lines += ["", "## Observations (segment x month x time band)",
              f"- Written: {o['rowsWritten']}  (positive {o['positive']}, of which training-eligible "
              f"{o['positiveTrainingEligible']}; negative {o['negative']})",
              f"- Positives outside complete coverage (kept, NOT for training): {o['positiveOutsideCompleteCoverage']}",
              f"- Left unlabelled: {o['unlabelled']}"]
    lines += [f"  - {k}: {v}" for k, v in o["unlabelledByReason"].items()]
    lines += ["", "## Coverage windows"]
    lines += [f"- `{w['id']}` complete={w['complete']} err={w['locationErrorM']}m delivered={w['recordsDeliveredInWindow']} "
              f"-> {'USED' if w['usable'] else 'NOT USED: ' + str(w['unusableReason'])}" for w in m["coverageWindows"]] \
        or ["- none declared: no negative label can exist"]
    lines += ["", "## Segments", f"- Read {m['inputs']['segmentsRead']}, usable {m['inputs']['segmentsUsable']}; "
              f"excluded: {m['inputs']['segmentExclusions'] or 'none'}"]
    if m["inputs"]["missingFeatureColumns"]:
        lines += [f"- Feature columns absent from the CSV (not imputed): {m['inputs']['missingFeatureColumns']}"]
    lines += ["", "## Rules in force", f"- Radius {m['config']['label_radius_m']:g} m, mode `{m['config']['match_mode']}`, "
              f"period {m['config']['period']}, duplicates: same category within {m['config']['dedupe_distance_m']:g} m / "
              f"{m['config']['dedupe_window_minutes']:g} min.",
              "- Positive: verified, in-scope, time known, location error <= radius. Negative: only inside a usable complete coverage window. "
              "Pending/uncertain incidents leave nearby rows unlabelled. SOS alarms are never incidents.",
              "", m["disclaimer"], ""]
    return "\n".join(lines)
