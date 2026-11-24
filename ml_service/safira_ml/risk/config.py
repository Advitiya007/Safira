"""Settings for the supervised pipeline. Every threshold is a stated judgement call, editable here."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path

from ..config import PACKAGE_ROOT

INCIDENT_DIR = PACKAGE_ROOT / "data" / "incidents"
MUNICIPAL_DIR = PACKAGE_ROOT / "data" / "municipal"

# Standard categories. Source labels must be mapped to these explicitly (category_map.json); an unmapped
# label is REJECTED, never guessed. Which categories count as "safety-related" is a project decision.
STANDARD_CATEGORIES = (
    "harassment", "stalking", "sexual_assault", "robbery_snatching", "assault",
    "kidnapping_abduction", "theft", "other_safety",
)
VERIFICATION_VALUES = ("verified", "unverified", "rejected")
SOURCES = ("ncrb", "police", "municipal", "field_survey", "user_report")
# Preference when two sources report the same event (first listed wins). Only used to choose which record
# represents a duplicate group; it never changes a label.
SOURCE_PRIORITY = ("police", "municipal", "field_survey", "user_report", "ncrb")
MATCH_MODES = ("radius", "nearest")

# Time bands in LOCAL time (start inclusive, end exclusive, hours). 'night' wraps midnight.
TIME_BANDS = {"night": (22, 5), "early": (5, 9), "day": (9, 17), "evening": (17, 22)}


@dataclass(frozen=True)
class RiskConfig:
    label_radius_m: float = 100.0          # incident counts for a segment if within this distance
    period: str = "month"                  # calendar period of one row
    incident_categories: tuple = STANDARD_CATEGORIES
    min_total_positives: int = 200         # below this no model is trained (too few events to learn from)
    min_positives_per_city: int = 30       # a city with fewer is not used as a held-out test city
    min_cities_with_labels: int = 2        # leave-one-city-out needs at least 2 (3+ recommended)
    min_negative_rows: int = 1000
    max_default_location_error_m: float = 100.0
    naive_timestamps_timezone: str = "Asia/Kolkata"   # used (and flagged) when a timestamp has no zone
    seed: int = 42
    # --- P3 dataset builder (all judgement calls, recorded in every dataset manifest) ---
    match_mode: str = "radius"             # "radius": every segment within label_radius_m of the incident gets y=1;
                                           # "nearest": only the single nearest segment does (others become unlabelled)
    dedupe_distance_m: float = 50.0        # same category + within this distance + within the window => same event
    dedupe_window_minutes: float = 120.0
    exclude_short_segments: bool = True    # is_short segments (< min_segment_m) are never labelled (as in K-Means)
    max_horizon_months: int = 240          # sanity limit on the observation horizon per city

    def to_dict(self) -> dict:
        return asdict(self)
