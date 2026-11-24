"""Coverage manifest: where and when "no recorded incident" may be read as a label of 0.

A missing record is NOT evidence that nothing happened. A (city, period) can produce negative labels only
if the data provider declared a ``complete`` window for it. Anything else stays *unlabelled*.

coverage.json::

    {"windows": [{"source": "police", "city_id": "delhi", "start": "2023-01-01", "end": "2024-01-01",
                  "complete": true, "location_error_m": 50, "notes": "All FIRs, station-geocoded to address"}]}
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

import pandas as pd

from ..config import CITY_META, SUPPORTED_CITIES
from .config import SOURCES


class CoverageError(ValueError):
    pass


@dataclass(frozen=True)
class CoverageWindow:
    source: str
    city_id: str
    start: pd.Timestamp        # UTC, inclusive
    end: pd.Timestamp          # UTC, exclusive
    complete: bool
    location_error_m: float
    notes: str = ""
    # Optional geographic limit {south, west, north, east}. None = the whole city. A segment can only be
    # labelled 0 by this window if its bounding box lies entirely inside it.
    bbox: Optional[dict] = None


def parse_coverage(payload) -> list[CoverageWindow]:
    entries = payload.get("windows") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        raise CoverageError('coverage file must look like {"windows": [ ... ]}')
    out = []
    for entry in entries:
        city_id, source = str(entry.get("city_id", "")).lower(), str(entry.get("source", "")).lower()
        if city_id not in SUPPORTED_CITIES:
            raise CoverageError(f"coverage window for unknown city {city_id!r}")
        if source not in SOURCES:
            raise CoverageError(f"coverage window with unknown source {source!r}")
        if not isinstance(entry.get("complete"), bool):
            raise CoverageError(f"{city_id}/{source}: 'complete' must be true or false (no guessing)")
        zone = ZoneInfo(CITY_META.get(city_id, {}).get("timezone", "Asia/Kolkata"))
        try:
            start, end = (pd.Timestamp(entry[k]) for k in ("start", "end"))
            start = (start.tz_localize(zone) if start.tzinfo is None else start).tz_convert("UTC")
            end = (end.tz_localize(zone) if end.tzinfo is None else end).tz_convert("UTC")
            error = float(entry["location_error_m"])
        except (KeyError, ValueError, TypeError) as exc:
            raise CoverageError(f"{city_id}/{source}: start, end and numeric location_error_m are required") from exc
        if not start < end or error < 0:
            raise CoverageError(f"{city_id}/{source}: need start < end and location_error_m >= 0")
        bbox = None
        if entry.get("bbox") is not None:
            try:
                bbox = {k: float(entry["bbox"][k]) for k in ("south", "west", "north", "east")}
            except (KeyError, TypeError, ValueError) as exc:
                raise CoverageError(f"{city_id}/{source}: bbox needs numeric south, west, north, east") from exc
            if not bbox["south"] < bbox["north"] or not bbox["west"] < bbox["east"]:
                raise CoverageError(f"{city_id}/{source}: bbox must have south < north and west < east")
        out.append(CoverageWindow(source, city_id, start, end, entry["complete"], error,
                                  str(entry.get("notes", "")), bbox))
    return out


def load_coverage(directory: Path) -> list[CoverageWindow]:
    path = Path(directory) / "coverage.json"
    if not path.is_file():
        return []
    try:
        return parse_coverage(json.loads(path.read_text(encoding="utf-8")))
    except json.JSONDecodeError as exc:
        raise CoverageError(f"{path}: not valid JSON ({exc})") from exc


def covering_window(windows: list[CoverageWindow], city_id: str, start: pd.Timestamp, end: pd.Timestamp,
                    max_location_error_m: float) -> Optional[CoverageWindow]:
    """A complete window that fully contains [start, end) and is geocoded finely enough, else None."""
    for window in windows:
        if (window.city_id == city_id and window.complete and window.location_error_m <= max_location_error_m
                and window.start <= start and end <= window.end):
            return window
    return None
