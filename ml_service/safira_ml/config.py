"""Static configuration shared by the extraction, training and API layers.

City bounding boxes mirror ``backend/src/config/safeRouteConfig.js``
(``tests/test_config_sync.py`` fails if they drift apart).
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from pathlib import Path

PIPELINE_VERSION = "1.0.0"
PACKAGE_ROOT = Path(__file__).resolve().parents[1]  # ml_service/

SUPPORTED_CITIES = ("jalandhar", "bathinda", "delhi")

# south, west, north, east (degrees) - same keys as the Node config
CITY_BOUNDING_BOXES = {
    "jalandhar": {"south": 31.25, "west": 75.47, "north": 31.42, "east": 75.67},
    "bathinda": {"south": 30.11, "west": 74.83, "north": 30.31, "east": 75.05},
    "delhi": {"south": 28.40, "west": 76.84, "north": 28.88, "east": 77.35},
}

# Mongoose pluralises model names: GeographicFeature -> geographicfeatures,
# RoadSegmentFeature -> roadsegmentfeatures.
GEOGRAPHIC_COLLECTION = os.environ.get("GEOGRAPHIC_FEATURE_COLLECTION", "geographicfeatures")
SEGMENT_COLLECTION = os.environ.get("ROAD_SEGMENT_COLLECTION", "roadsegmentfeatures")

# OSM highway values treated as road segments, grouped for modelling.
ROAD_GROUPS = ("major", "secondary_tertiary", "local", "service", "pedestrian_path")
HIGHWAY_TO_GROUP = {
    "motorway": "major", "motorway_link": "major",
    "trunk": "major", "trunk_link": "major",
    "primary": "major", "primary_link": "major",
    "secondary": "secondary_tertiary", "secondary_link": "secondary_tertiary",
    "tertiary": "secondary_tertiary", "tertiary_link": "secondary_tertiary",
    "unclassified": "local", "residential": "local", "living_street": "local",
    "service": "service", "track": "service",
    "pedestrian": "pedestrian_path", "footway": "pedestrian_path", "path": "pedestrian_path",
    "cycleway": "pedestrian_path", "steps": "pedestrian_path",
}

# Raw (human-readable) feature columns written to road_features.csv / Mongo.
RAW_FEATURE_COLUMNS = (
    "length_m",
    "police_count", "police_nearest_m",
    "hospital_count", "hospital_nearest_m",
    "pharmacy_count", "pharmacy_nearest_m",
    "shop_count",
    "transport_count",
    "establishment_count", "establishment_density_per_km2",
    "foot_access", "vehicle_access", "sidewalk_present",
)
INFORMATIONAL_COLUMNS = ("lit_tag",)  # recorded, never modelled

# Candidate numeric model features (subject to automatic coverage checks).
MODEL_NUMERIC_CANDIDATES = (
    "length_m",
    "police_count", "police_nearest_m",
    "hospital_count", "hospital_nearest_m",
    "pharmacy_count", "pharmacy_nearest_m",
    "shop_count",
    "transport_count",
    "establishment_density_per_km2",
    "foot_access", "vehicle_access", "sidewalk_present",
)
LOG1P_FEATURES = frozenset({
    "length_m", "police_count", "police_nearest_m", "hospital_count", "hospital_nearest_m",
    "pharmacy_count", "pharmacy_nearest_m", "shop_count", "transport_count",
    "establishment_density_per_km2",
})
# Directional groups used only to rank/name clusters.
ACCESS_COUNT_FEATURES = (
    "police_count", "hospital_count", "pharmacy_count", "shop_count",
    "transport_count", "establishment_density_per_km2",
)
ACCESS_DISTANCE_FEATURES = ("police_nearest_m", "hospital_nearest_m", "pharmacy_nearest_m")

DISCLAIMER = (
    "Clusters describe the availability and spatial distribution of mapped OpenStreetMap "
    "infrastructure. They are not crime predictions, do not measure safety, and a missing "
    "mapped feature is not proof that it does not exist."
)


@dataclass(frozen=True)
class ExtractionParams:
    max_segment_m: float = 200.0      # long road pieces are split into equal parts
    min_segment_m: float = 20.0       # shorter pieces are kept but flagged is_short
    activity_radius_m: float = 200.0  # shops / establishments / public transport
    emergency_radius_m: float = 1000.0  # police / hospital / pharmacy (matches backend config)
    junction_precision: int = 7       # decimals used to match shared OSM node coordinates

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class TrainingParams:
    k_min: int = 2
    k_max: int = 10
    seed: int = 42
    min_feature_coverage: float = 0.6   # per city; below this the feature is dropped
    min_cluster_fraction: float = 0.02  # candidate k rejected if a cluster is smaller
    silhouette_sample: int = 10_000
    per_city_cap: int = 20_000          # balance cities in the global model
    exclude_edge_segments: bool = False
    stability_runs: int = 5


def data_dir() -> Path:
    path = Path(os.environ.get("ML_DATA_DIR", PACKAGE_ROOT / "data"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def model_dir() -> Path:
    path = Path(os.environ.get("ML_MODEL_DIR", PACKAGE_ROOT / "models"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def reports_dir() -> Path:
    path = Path(os.environ.get("ML_REPORT_DIR", PACKAGE_ROOT / "reports"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def feature_info(params: "ExtractionParams | None" = None) -> dict:
    """Human-readable definition of every feature (radii come from the extraction params)."""
    p = params or ExtractionParams()
    emergency, activity = int(p.emergency_radius_m), int(p.activity_radius_m)
    return {
        "length_m": {"label": "Segment length", "unit": "m",
                     "description": "Length of the road segment (roads are split at junctions and at most "
                                    f"{int(p.max_segment_m)} m)."},
        "police_count": {"label": "Mapped police stations nearby", "unit": "count",
                         "description": f"Mapped amenity=police features within {emergency} m."},
        "police_nearest_m": {"label": "Distance to nearest mapped police station", "unit": "m",
                             "description": "Straight-line distance to the nearest mapped police feature in the city data."},
        "hospital_count": {"label": "Mapped hospitals/clinics nearby", "unit": "count",
                           "description": f"Mapped amenity=hospital or clinic features within {emergency} m."},
        "hospital_nearest_m": {"label": "Distance to nearest mapped hospital/clinic", "unit": "m",
                               "description": "Straight-line distance to the nearest mapped hospital or clinic."},
        "pharmacy_count": {"label": "Mapped pharmacies nearby", "unit": "count",
                           "description": f"Mapped amenity=pharmacy features within {emergency} m."},
        "pharmacy_nearest_m": {"label": "Distance to nearest mapped pharmacy", "unit": "m",
                               "description": "Straight-line distance to the nearest mapped pharmacy."},
        "shop_count": {"label": "Mapped shops nearby", "unit": "count",
                       "description": f"Mapped shop=* features within {activity} m."},
        "transport_count": {"label": "Mapped public-transport stops nearby", "unit": "count",
                            "description": f"Mapped bus stops, stations and halts within {activity} m."},
        "establishment_density_per_km2": {"label": "Mapped establishment density", "unit": "per km2",
                                          "description": f"Mapped shops, food outlets, pharmacies and fuel stations within {activity} m, divided by the search area."},
        "foot_access": {"label": "Foot access (explicit tag)", "unit": "0/1",
                        "description": "From an explicit foot=* tag only; unknown when untagged."},
        "vehicle_access": {"label": "Vehicle access (explicit tag)", "unit": "0/1",
                           "description": "From explicit motor_vehicle/vehicle tags only; unknown when untagged."},
        "sidewalk_present": {"label": "Sidewalk mapped (explicit tag)", "unit": "0/1",
                             "description": "From explicit sidewalk tags only; unknown when untagged."},
    }
