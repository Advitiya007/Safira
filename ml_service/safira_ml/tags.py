"""OSM tag classifiers.

These mirror the definitions in ``backend/src/services/routeScoringService.js`` and
``osmBoundingBoxImportService.js`` so the ML features describe the same things the
existing route indicators do. Note that ``GeographicFeature.featureCategories`` has no
police/hospital/pharmacy/shop values (it holds roads, activity, emergency,
publicTransport, lighting, surveillance), so classes are derived from tags.
"""

from __future__ import annotations

import math
from typing import Mapping, Optional

from .config import HIGHWAY_TO_GROUP

ACTIVITY_AMENITIES = frozenset({
    "restaurant", "cafe", "fast_food", "pub", "bar", "food_court", "marketplace",
    "pharmacy", "fuel",
})
TRANSPORT_VALUES = frozenset({"bus_stop", "station", "halt", "tram_stop"})

_ALLOWED = {"yes", "designated", "permissive"}
_RESTRICTED = {"no", "private"}
_SIDEWALK_YES = {"both", "left", "right", "yes", "separate"}
_SIDEWALK_NO = {"no", "none"}


def _t(tags: Mapping, key: str) -> Optional[str]:
    value = tags.get(key)
    return value.strip().lower() if isinstance(value, str) else None


def is_police(tags: Mapping) -> bool:
    return _t(tags, "amenity") == "police"


def is_hospital(tags: Mapping) -> bool:
    """Hospital or clinic - the existing scoring groups them as 'hospital/clinic'."""
    return _t(tags, "amenity") in {"hospital", "clinic"}


def is_pharmacy(tags: Mapping) -> bool:
    return _t(tags, "amenity") == "pharmacy"


def is_shop(tags: Mapping) -> bool:
    shop = _t(tags, "shop")
    return shop is not None and shop != "no"


def is_establishment(tags: Mapping) -> bool:
    return is_shop(tags) or _t(tags, "amenity") in ACTIVITY_AMENITIES


def is_public_transport(tags: Mapping) -> bool:
    return (
        _t(tags, "highway") in TRANSPORT_VALUES
        or _t(tags, "public_transport") in TRANSPORT_VALUES
        or _t(tags, "railway") in {"station", "halt"}
        or _t(tags, "amenity") == "bus_station"
    )


POI_PREDICATES = {
    "police": is_police,
    "hospital": is_hospital,
    "pharmacy": is_pharmacy,
    "shop": is_shop,
    "transport": is_public_transport,
    "establishment": is_establishment,
}


def road_highway(tags: Mapping) -> Optional[str]:
    """Return the highway value if it is a modelled road type, else None."""
    highway = _t(tags, "highway")
    return highway if highway in HIGHWAY_TO_GROUP else None


def is_area_tagged(tags: Mapping) -> bool:
    return _t(tags, "area") == "yes"


def _binary(value: Optional[str]) -> float:
    if value in _ALLOWED:
        return 1.0
    if value in _RESTRICTED:
        return 0.0
    return math.nan  # missing or ambiguous (e.g. destination, agricultural)


def foot_access(tags: Mapping) -> float:
    return _binary(_t(tags, "foot"))


def vehicle_access(tags: Mapping) -> float:
    return _binary(_t(tags, "motor_vehicle") or _t(tags, "vehicle"))


def sidewalk_present(tags: Mapping) -> float:
    value = _t(tags, "sidewalk")
    if value in _SIDEWALK_YES:
        return 1.0
    if value in _SIDEWALK_NO:
        return 0.0
    sides = [_t(tags, f"sidewalk:{side}") for side in ("both", "left", "right")]
    if any(side in _SIDEWALK_YES for side in sides):
        return 1.0
    return math.nan


def lit_tag(tags: Mapping) -> float:
    value = _t(tags, "lit")
    if value == "yes":
        return 1.0
    if value == "no":
        return 0.0
    return math.nan
