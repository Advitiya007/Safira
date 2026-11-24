"""Load and validate incident records. Nothing is invented, repaired silently or inferred.

Input contract (CSV or JSONL; see ML_PREDICTION_PROGRESS.md section 3.3). Every rejected row is counted
with a reason so a data provider can fix the file. A row is only ever *dropped*, never "corrected".
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

import pandas as pd

from ..config import CITY_BOUNDING_BOXES, CITY_META
from .config import SOURCES, STANDARD_CATEGORIES, VERIFICATION_VALUES, RiskConfig

REQUIRED_COLUMNS = ("incident_id", "source", "category", "occurred_at", "lat", "lon", "verification")
OPTIONAL_COLUMNS = ("source_ref", "location_error_m", "city_id")
CLEAN_COLUMNS = ("incident_id", "source", "source_ref", "category", "occurred_at_utc", "occurred_local",
                 "time_known", "timezone_assumed", "lat", "lon", "location_error_m", "verification", "city_id")


class IncidentFileError(ValueError):
    """The file cannot be read as an incident table at all (e.g. a required column is missing)."""


def read_table(path: Path) -> pd.DataFrame:
    suffix = Path(path).suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path, dtype=str, keep_default_na=False)
    if suffix in {".jsonl", ".ndjson"}:
        rows = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
        return pd.DataFrame(rows).astype(object).where(lambda f: f.notna(), "").astype(str)
    raise IncidentFileError(f"{path}: unsupported file type (use .csv or .jsonl)")


def city_for_point(lat: float, lon: float) -> Optional[str]:
    """City whose configured bounding box contains the point (smallest box wins on overlap)."""
    best, best_area = None, None
    for city_id, box in CITY_BOUNDING_BOXES.items():
        if box["south"] <= lat <= box["north"] and box["west"] <= lon <= box["east"]:
            area = (box["north"] - box["south"]) * (box["east"] - box["west"])
            if best is None or area < best_area:
                best, best_area = city_id, area
    return best


def _parse_time(value: str, assumed_tz: str):
    """Return (utc Timestamp, local-naive Timestamp placeholder, time_known, tz_assumed) or None."""
    text = (value or "").strip()
    if not text:
        return None
    date_only = len(text) <= 10
    try:
        stamp = pd.Timestamp(text)
    except (ValueError, TypeError):
        return None
    if pd.isna(stamp):
        return None
    assumed = stamp.tzinfo is None
    if assumed:
        stamp = stamp.tz_localize(ZoneInfo(assumed_tz))
    return stamp.tz_convert("UTC"), (not date_only), assumed


def validate_incidents(raw: pd.DataFrame, config: Optional[RiskConfig] = None,
                       category_map: Optional[dict] = None) -> tuple[pd.DataFrame, dict]:
    """Return (clean frame, report). Raises IncidentFileError if required columns are absent."""
    config = config or RiskConfig()
    missing = [column for column in REQUIRED_COLUMNS if column not in raw.columns]
    if missing:
        raise IncidentFileError(f"missing required columns: {', '.join(missing)}")
    category_map = {str(k).strip().lower(): v for k, v in (category_map or {}).items()}
    rejected, kept = Counter(), []
    seen = set()
    for row in raw.to_dict("records"):
        incident_id = str(row.get("incident_id", "")).strip()
        source = str(row.get("source", "")).strip().lower()
        if not incident_id:
            rejected["missing_incident_id"] += 1
            continue
        if source not in SOURCES:
            rejected["unknown_source"] += 1
            continue
        key = (source, incident_id)
        if key in seen:
            rejected["duplicate_incident_id"] += 1
            continue
        seen.add(key)
        verification = str(row.get("verification", "")).strip().lower()
        if verification not in VERIFICATION_VALUES:
            rejected["invalid_verification_value"] += 1
            continue
        label = str(row.get("category", "")).strip().lower()
        category = label if label in STANDARD_CATEGORIES else category_map.get(label)
        if category not in STANDARD_CATEGORIES:
            rejected["unmapped_category"] += 1
            continue
        try:
            lat, lon = float(row["lat"]), float(row["lon"])
        except (TypeError, ValueError):
            rejected["missing_or_invalid_coordinates"] += 1
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
            rejected["missing_or_invalid_coordinates"] += 1
            continue
        city_id = city_for_point(lat, lon)
        if city_id is None:
            rejected["outside_configured_cities"] += 1
            continue
        declared_city = str(row.get("city_id", "")).strip().lower()
        if declared_city and declared_city != city_id:
            rejected["city_id_disagrees_with_coordinates"] += 1
            continue
        parsed = _parse_time(str(row.get("occurred_at", "")), config.naive_timestamps_timezone)
        if parsed is None:
            rejected["missing_or_invalid_time"] += 1
            continue
        utc, time_known, tz_assumed = parsed
        error_text = str(row.get("location_error_m", "")).strip()
        try:
            error_m = float(error_text) if error_text else float("nan")
        except ValueError:
            rejected["invalid_location_error"] += 1
            continue
        if error_m == error_m and error_m < 0:
            rejected["invalid_location_error"] += 1
            continue
        zone = ZoneInfo(CITY_META.get(city_id, {}).get("timezone", "Asia/Kolkata"))
        kept.append({
            "incident_id": incident_id, "source": source, "source_ref": str(row.get("source_ref", "")).strip(),
            "category": category, "occurred_at_utc": utc, "occurred_local": utc.tz_convert(zone).tz_localize(None),
            "time_known": time_known, "timezone_assumed": tz_assumed, "lat": lat, "lon": lon,
            "location_error_m": error_m, "verification": verification, "city_id": city_id,
        })
    frame = pd.DataFrame(kept, columns=list(CLEAN_COLUMNS))
    report = {"rowsRead": int(len(raw)), "rowsKept": int(len(frame)), "rejected": dict(rejected),
              "assumedTimezoneRows": int(frame["timezone_assumed"].sum()) if len(frame) else 0,
              "dateOnlyRows": int((~frame["time_known"]).sum()) if len(frame) else 0,
              "unknownLocationErrorRows": int(frame["location_error_m"].isna().sum()) if len(frame) else 0}
    return frame, report


def load_category_map(directory: Path) -> dict:
    path = Path(directory) / "category_map.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def load_incident_dir(directory: Path, config: Optional[RiskConfig] = None) -> tuple[pd.DataFrame, dict]:
    """Load every ``*.csv``/``*.jsonl`` in a directory (except coverage/category_map)."""
    directory = Path(directory)
    files = sorted(p for p in directory.glob("*") if p.suffix.lower() in {".csv", ".jsonl", ".ndjson"}) \
        if directory.is_dir() else []
    category_map = load_category_map(directory) if directory.is_dir() else {}
    frames, per_file, totals = [], {}, Counter()
    for path in files:
        try:
            clean, report = validate_incidents(read_table(path), config, category_map)
        except IncidentFileError as exc:
            per_file[path.name] = {"error": str(exc)}
            continue
        per_file[path.name] = report
        totals.update(report["rejected"])
        frames.append(clean)
    frame = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=list(CLEAN_COLUMNS))
    if len(frame):
        before = len(frame)
        frame = frame.drop_duplicates(subset=["source", "incident_id"]).reset_index(drop=True)
        if before != len(frame):
            totals["duplicate_across_files"] += before - len(frame)
    return frame, {"files": per_file, "rejected": dict(totals), "directory": str(directory)}
