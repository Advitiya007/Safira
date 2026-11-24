"""Dynamic city registry tests (test fixtures only)."""
import json

import pytest

from safira_ml.cities import CityConfigError, load_cities_file, parse_cities
from safira_ml.config import BUILTIN_CITIES, CITY_BOUNDING_BOXES, SUPPORTED_CITIES

GOOD = {"cities": [{"id": "ludhiana", "name": "Ludhiana", "state": "Punjab",
                    "bbox": {"south": 30.82, "west": 75.74, "north": 30.97, "east": 75.97}}]}


def test_builtins_unchanged_and_registered():
    assert BUILTIN_CITIES == ("jalandhar", "bathinda", "delhi")
    assert set(BUILTIN_CITIES) <= set(SUPPORTED_CITIES) and set(BUILTIN_CITIES) <= set(CITY_BOUNDING_BOXES)


def test_valid_city_is_normalised_with_default_timezone():
    (city,) = parse_cities(GOOD, reserved=BUILTIN_CITIES)
    assert city["id"] == "ludhiana" and city["timezone"] == "Asia/Kolkata"


@pytest.mark.parametrize("mutate,message", [
    (lambda c: c.update(id="Delhi"), "invalid city id"),
    (lambda c: c.update(id="delhi"), "duplicate or reserved"),
    (lambda c: c["bbox"].update(south=31.0, north=30.0), "south < north"),
    (lambda c: c.update(bbox={"south": 75.0, "west": 30.0, "north": 76.0, "east": 31.0}), "outside India"),
    (lambda c: c["bbox"].update(south=28.0, north=31.0), "spans more than"),
    (lambda c: c.update(bbox={"south": 1}), "numeric"),
])
def test_invalid_entries_fail_loudly(mutate, message):
    payload = json.loads(json.dumps(GOOD))
    mutate(payload["cities"][0])
    with pytest.raises(CityConfigError, match=message):
        parse_cities(payload, reserved=BUILTIN_CITIES)


def test_duplicate_ids_inside_file_rejected():
    payload = {"cities": GOOD["cities"] * 2}
    with pytest.raises(CityConfigError, match="duplicate"):
        parse_cities(payload)


def test_missing_file_means_no_extra_cities_and_bad_json_is_an_error(tmp_path):
    assert load_cities_file(tmp_path / "nope.json") == []
    bad = tmp_path / "bad.json"
    bad.write_text("{oops", encoding="utf-8")
    with pytest.raises(CityConfigError, match="not valid JSON"):
        load_cities_file(bad)


def test_extra_city_flows_into_config_via_env(tmp_path):
    """Run in a subprocess so reloading config cannot leak into other tests."""
    import subprocess
    import sys
    path = tmp_path / "cities.json"
    path.write_text(json.dumps(GOOD), encoding="utf-8")
    code = ("import safira_ml.config as c;"
            "print('ludhiana' in c.SUPPORTED_CITIES, c.CITY_BOUNDING_BOXES['ludhiana']['south'],"
            " c.BUILTIN_CITY_BOUNDING_BOXES['delhi'] == c.CITY_BOUNDING_BOXES['delhi'])")
    env = {**__import__("os").environ, "SAFIRA_CITIES_FILE": str(path)}
    out = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True)
    assert out.stdout.split() == ["True", "30.82", "True"]
