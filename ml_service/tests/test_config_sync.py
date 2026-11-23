import re
from pathlib import Path

from safira_ml.config import CITY_BOUNDING_BOXES, ExtractionParams

JS = Path(__file__).resolve().parents[2] / "backend/src/config/safeRouteConfig.js"


def test_bounding_boxes_match_node_config():
    text = JS.read_text(encoding="utf-8")
    block = re.search(r"CITY_BOUNDING_BOXES\s*=\s*\{(.*?)\n\};", text, re.S).group(1)
    parsed = {}
    for city, body in re.findall(r"(\w+):\s*\{([^}]*)\}", block):
        parsed[city] = {k: float(v) for k, v in re.findall(r"(south|west|north|east):\s*([\d.]+)", body)}
    assert parsed == CITY_BOUNDING_BOXES


def test_emergency_radius_matches_node_config():
    text = JS.read_text(encoding="utf-8")
    radius = float(re.search(r"EMERGENCY_FACILITY_SEARCH_RADIUS_METERS\s*=\s*(\d+)", text).group(1))
    assert ExtractionParams().emergency_radius_m == radius
