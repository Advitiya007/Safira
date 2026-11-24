"""Dynamic city registry (pure functions; no dependency on config.py).

Built-in cities (Jalandhar, Bathinda, Delhi) stay defined in ``config.py``. Additional Indian cities
are added by dropping a JSON file (``SAFIRA_CITIES_FILE`` or ``ml_service/cities.json``) - no code
change and no hard-coding per city::

    {"cities": [{"id": "ludhiana", "name": "Ludhiana", "state": "Punjab",
                 "bbox": {"south": 30.82, "west": 75.74, "north": 30.97, "east": 75.97}}]}

The UTM zone is always derived from the bounding box centre (``geo.utm_crs_for``), so nothing else
needs configuring. An invalid file fails loudly rather than silently dropping a city.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterable, Optional

ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
# Rough extent of India incl. islands; catches swapped lat/lon and typos, not a border check.
INDIA_LAT = (6.0, 37.5)
INDIA_LON = (68.0, 98.0)
MAX_SPAN_DEG = 1.5          # a "city" box wider than this is almost certainly a mistake
DEFAULT_TIMEZONE = "Asia/Kolkata"


class CityConfigError(ValueError):
    """The extra-cities file is invalid."""


def _validate_bbox(city_id: str, bbox) -> dict:
    if not isinstance(bbox, dict):
        raise CityConfigError(f"{city_id}: bbox must be an object with south/west/north/east")
    try:
        box = {key: float(bbox[key]) for key in ("south", "west", "north", "east")}
    except (KeyError, TypeError, ValueError) as exc:
        raise CityConfigError(f"{city_id}: bbox needs numeric south, west, north, east") from exc
    if not box["south"] < box["north"] or not box["west"] < box["east"]:
        raise CityConfigError(f"{city_id}: bbox must have south < north and west < east")
    if not (INDIA_LAT[0] <= box["south"] and box["north"] <= INDIA_LAT[1]
            and INDIA_LON[0] <= box["west"] and box["east"] <= INDIA_LON[1]):
        raise CityConfigError(f"{city_id}: bbox is outside India (are latitude and longitude swapped?)")
    if box["north"] - box["south"] > MAX_SPAN_DEG or box["east"] - box["west"] > MAX_SPAN_DEG:
        raise CityConfigError(f"{city_id}: bbox spans more than {MAX_SPAN_DEG} degrees; use a city-sized box")
    return box


def parse_cities(payload, reserved: Iterable[str] = ()) -> list[dict]:
    """Validate a parsed JSON payload and return normalised city dicts."""
    entries = payload.get("cities") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        raise CityConfigError('cities file must look like {"cities": [ ... ]}')
    taken = set(reserved)
    out = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise CityConfigError("every city entry must be an object")
        city_id = str(entry.get("id", "")).strip()
        if not ID_PATTERN.match(city_id):
            raise CityConfigError(f"invalid city id {city_id!r}: use lowercase letters, digits, underscore")
        if city_id in taken:
            raise CityConfigError(f"duplicate or reserved city id {city_id!r} (built-in cities cannot be overridden)")
        taken.add(city_id)
        name = str(entry.get("name") or city_id.replace("_", " ").title()).strip()
        out.append({
            "id": city_id,
            "name": name,
            "state": str(entry.get("state") or "").strip() or None,
            "timezone": str(entry.get("timezone") or DEFAULT_TIMEZONE),
            "bbox": _validate_bbox(city_id, entry.get("bbox")),
        })
    return out


def load_cities_file(path: Optional[Path], reserved: Iterable[str] = ()) -> list[dict]:
    """Load extra cities; a missing file means "no extra cities"."""
    if path is None or not Path(path).is_file():
        return []
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CityConfigError(f"{path}: not valid JSON ({exc})") from exc
    return parse_cities(payload, reserved)
