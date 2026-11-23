import pandas as pd
import pytest

from safira_ml.config import TrainingParams
from safira_ml.extract import extract_city
from tests.synthetic import make_city_docs

CITY_SETUP = [("jalandhar", 1, True, 1.0), ("bathinda", 2, False, 0.7), ("delhi", 3, True, 1.3)]


@pytest.fixture(scope="session")
def city_frames():
    frames, metas = {}, {}
    for city, seed, pharmacy, scale in CITY_SETUP:
        frames[city], metas[city] = extract_city(
            city, make_city_docs(city, seed=seed, with_pharmacy=pharmacy, rich_scale=scale))
    return frames, metas


@pytest.fixture(scope="session")
def all_frame(city_frames):
    return pd.concat(list(city_frames[0].values()), ignore_index=True)


@pytest.fixture(scope="session")
def params():
    return TrainingParams(per_city_cap=800, stability_runs=3)
