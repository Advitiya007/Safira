"""Incident-data adapters: the ONLY place that knows where incident records come from.

The dataset builder consumes an ``IncidentSource``: anything with ``name`` and ``load(config)`` returning
``(clean_frame, report)`` in the P2 schema (``incidents.CLEAN_COLUMNS``). Two implementations:

* ``FileIncidentSource``  - ``ml_service/data/incidents/*.csv|jsonl`` (the P2 contract; works today).
* ``BackendIncidentSource`` - documents exported from / read from the backend's incident-report store
  (verification status ``PENDING | VERIFIED | REJECTED``, ``verifiedBy/At``, ``rejectedBy/At``).

!! The backend adapter is built against the INTEGRATION CONTRACT that was described for the incident-reporting
!! workflow, NOT against its real schema (that implementation was not available when P3 was written). The
!! field names below are therefore *candidates*; every one can be overridden with a JSON field map
!! (``--field-map``) without code changes. A document whose required field cannot be found is REJECTED with a
!! counted reason ("never repaired, never guessed"). Verify against the real model before first use.

Hard rules enforced here:
* SOS alarms are not incidents. The SOS / activity collections are never read (``FORBIDDEN_COLLECTIONS``) and
  ``sos`` is not an accepted ``source``.
* The collection name must be given explicitly - there is no default guess.
* BSON datetimes are UTC by definition, so a naive ``datetime`` from the database is tagged UTC (the P2
  "naive text => local time" rule only applies to text without a zone).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional, Protocol

import pandas as pd

from .config import INCIDENT_DIR, RiskConfig
from .coverage import CoverageWindow, load_coverage
from .incidents import (CLEAN_COLUMNS, PROVENANCE_COLUMNS, load_category_map, load_incident_dir,
                        validate_incidents)

FORBIDDEN_COLLECTIONS = frozenset({"sos", "sosalerts", "sos_alerts", "soss", "activities", "activity", "users",
                                   "guardians"})

# Contract vocabulary -> P2 vocabulary. Anything else is rejected downstream (invalid_verification_value).
STATUS_MAP = {"verified": "verified", "pending": "unverified", "rejected": "rejected"}

DEFAULT_FIELD_MAP: dict[str, list[str]] = {
    "incident_id": ["_id", "id", "incidentId"],
    "category": ["category", "type", "incidentType"],
    "lat": ["latitude", "lat", "location.latitude", "location.lat", "location.coordinates.1"],
    "lon": ["longitude", "lon", "lng", "location.longitude", "location.lon", "location.lng",
            "location.coordinates.0"],
    "occurred_at": ["incidentAt", "occurredAt", "incidentDateTime", "dateTime", "incidentDate"],
    "verification": ["verificationStatus", "status", "reportStatus"],
    "location_error_m": ["locationAccuracyM", "accuracyMeters", "gpsAccuracy", "locationErrorM"],
    "submitted_at": ["submittedAt", "createdAt"],
    "verified_by": ["verifiedBy"], "verified_at": ["verifiedAt"],
    "rejected_by": ["rejectedBy"], "rejected_at": ["rejectedAt"],
    "source_ref": ["reportId", "referenceId"],
}
REQUIRED_TARGETS = ("incident_id", "category", "lat", "lon", "occurred_at", "verification")


class IncidentSource(Protocol):
    name: str

    def load(self, config: Optional[RiskConfig] = None) -> tuple[pd.DataFrame, dict]: ...


class FileIncidentSource:
    """P2 file contract. Coverage windows live beside the data in ``coverage.json``."""

    def __init__(self, directory: Optional[Path] = None):
        self.directory = Path(directory or INCIDENT_DIR)
        self.name = f"files:{self.directory}"

    def load(self, config: Optional[RiskConfig] = None) -> tuple[pd.DataFrame, dict]:
        frame, report = load_incident_dir(self.directory, config)
        report["adapter"] = "file"
        return frame, report

    def coverage(self) -> list[CoverageWindow]:
        return load_coverage(self.directory)

    def input_files(self) -> list[Path]:
        if not self.directory.is_dir():
            return []
        return sorted(p for p in self.directory.glob("*") if p.is_file()
                      and p.suffix.lower() in {".csv", ".jsonl", ".ndjson", ".json"})


def _get_path(document: Any, path: str) -> Any:
    """Dotted path lookup; integer segments index lists (GeoJSON ``location.coordinates.0``)."""
    current = document
    for part in path.split("."):
        if isinstance(current, dict):
            if part not in current:
                return None
            current = current[part]
        elif isinstance(current, (list, tuple)) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            return None
    return current


def _to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        # BSON/pymongo datetimes are UTC; a naive one must not be re-interpreted as local time.
        stamp = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return stamp.isoformat()
    return str(value)


def map_backend_documents(documents: Iterable[dict], field_map: Optional[dict] = None,
                          source_name: str = "user_report") -> tuple[pd.DataFrame, dict]:
    """Map exported incident-report documents to the P2 raw table (strings) + counted mapping failures."""
    fields = {**DEFAULT_FIELD_MAP, **{k: list(v) if isinstance(v, (list, tuple)) else [v]
                                      for k, v in (field_map or {}).items()}}
    rows, failures = [], {}
    for document in documents:
        row, missing = {"source": source_name}, None
        for target, candidates in fields.items():
            value = next((v for v in (_get_path(document, c) for c in candidates)
                          if v is not None and v != ""), None)
            if value is None and target in REQUIRED_TARGETS:
                missing = target
                break
            row[target] = _to_text(value)
        if missing:
            key = f"mapping_missing_field:{missing}"
            failures[key] = failures.get(key, 0) + 1
            continue
        status = row["verification"].strip().lower()
        row["verification"] = STATUS_MAP.get(status, status)       # unknown values are rejected by validate_incidents
        rows.append(row)
    return pd.DataFrame(rows), {"mappingFailures": failures, "documentsMapped": len(rows)}


class BackendIncidentSource:
    """Incident reports read through ``map_backend_documents``. Build with ``from_documents`` / ``from_database``."""

    def __init__(self, documents: Iterable[dict], label: str, field_map: Optional[dict] = None,
                 source_name: str = "user_report", category_map: Optional[dict] = None,
                 coverage_windows: Optional[list[CoverageWindow]] = None):
        self._documents = list(documents)
        self.name = f"backend:{label}"
        self.field_map, self.source_name = field_map, source_name
        self.category_map = category_map or {}
        self._coverage = coverage_windows or []

    @classmethod
    def from_documents(cls, documents: Iterable[dict], label: str = "export", **kwargs) -> "BackendIncidentSource":
        return cls(documents, label, **kwargs)

    @classmethod
    def from_jsonl(cls, path: Path, **kwargs) -> "BackendIncidentSource":
        lines = Path(path).read_text(encoding="utf-8").splitlines()
        return cls((json.loads(line) for line in lines if line.strip()), label=str(path), **kwargs)

    @classmethod
    def from_database(cls, database, collection: str, **kwargs) -> "BackendIncidentSource":
        if not collection or not str(collection).strip():
            raise ValueError("the incident collection must be named explicitly (no default is assumed)")
        if str(collection).strip().lower() in FORBIDDEN_COLLECTIONS:
            raise ValueError(f"refusing to read {collection!r}: SOS alarms and activity logs are not "
                             "confirmed incidents")
        return cls(database[collection].find({}), label=f"mongo:{collection}", **kwargs)

    def load(self, config: Optional[RiskConfig] = None) -> tuple[pd.DataFrame, dict]:
        raw, mapping = map_backend_documents(self._documents, self.field_map, self.source_name)
        if raw.empty:
            empty = pd.DataFrame(columns=list(CLEAN_COLUMNS))
            return empty, {"files": {}, "rejected": dict(mapping["mappingFailures"]), "directory": self.name,
                           "adapter": "backend", **mapping}
        clean, report = validate_incidents(raw, config, self.category_map)
        clean["source_file"] = self.name
        rejected = {**report["rejected"], **mapping["mappingFailures"]}
        return clean, {"files": {self.name: report}, "rejected": rejected, "directory": self.name,
                       "adapter": "backend", **mapping}

    def coverage(self) -> list[CoverageWindow]:
        return self._coverage

    def input_files(self) -> list[Path]:
        return []


__all__ = ["BackendIncidentSource", "DEFAULT_FIELD_MAP", "FORBIDDEN_COLLECTIONS", "FileIncidentSource",
           "IncidentSource", "PROVENANCE_COLUMNS", "STATUS_MAP", "load_category_map", "map_backend_documents"]
