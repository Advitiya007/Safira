import os
from pathlib import Path
from dotenv import load_dotenv

# Base paths
ML_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = ML_DIR.parent
DATA_DIR = ML_DIR / "data"
MODELS_DIR = ML_DIR / "models"
REPORTS_DIR = ML_DIR / "reports"
FIGURES_DIR = REPORTS_DIR / "figures"

# Ensure directories exist
for directory in [DATA_DIR, MODELS_DIR, REPORTS_DIR, FIGURES_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

# Load environment variables
dotenv_path = PROJECT_ROOT / "backend" / ".env"
if dotenv_path.exists():
    load_dotenv(dotenv_path)
else:
    load_dotenv(PROJECT_ROOT / ".env")

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/safeher")

# Supported cities
SUPPORTED_CITIES = ["jalandhar", "bathinda", "delhi"]

# Spatial Feature Configuration (radii in meters)
SPATIAL_RADII = {
    "police": 1000,
    "hospital": 1000,
    "pharmacy": 500,
    "shop": 250,
    "transit": 500,
    "lighting": 100,
    "cctv": 250,
}

# Road segmentation parameters
TARGET_SEGMENT_LENGTH_METERS = 150
MAX_FACILITY_DISTANCE_METERS = 2500.0  # Clamp value for nearest facility distances

# Feature definitions for clustering
NUMERICAL_FEATURES = [
    "road_length_m",
    "police_count_1km",
    "nearest_police_dist_m",
    "hospital_count_1km",
    "nearest_hospital_dist_m",
    "pharmacy_count_500m",
    "nearest_pharmacy_dist_m",
    "shop_count_250m",
    "establishment_density_sqkm",
    "transit_count_500m",
    "nearest_transit_dist_m",
    "lighting_signals_count",
    "road_accessibility_score",
]

CATEGORICAL_FEATURES = [
    "highway_type",
]

# K-Means Hyperparameters & Evaluation Range
K_RANGE = list(range(2, 9))
RANDOM_STATE = 42
N_INIT = 20
