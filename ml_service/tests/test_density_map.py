"""Density map tests. Data are SYNTHETIC test fixtures (never stored anywhere)."""
import pytest

from safira_ml.density_map import LEVEL_ORDER, assign_levels, level_shares, plot_density_map
from safira_ml.training import train_model


@pytest.fixture(scope="module")
def trained(all_frame, params):
    return train_model(all_frame, "global", params, None).bundle


def test_levels_use_saved_model_and_known_level_names(all_frame, trained):
    rows = assign_levels(all_frame, trained)
    assert len(rows) > 0 and not rows["is_short"].any()
    assert set(rows["level"]) <= set(LEVEL_ORDER)
    assert rows[["mid_lat", "mid_lon"]].notna().all().all()


def test_shares_sum_to_100_per_city(all_frame, trained):
    shares = level_shares(assign_levels(all_frame, trained))
    assert shares.sum(axis=1).round(0).eq(100).all()


def test_png_is_written_and_labelled_not_safety(all_frame, trained, tmp_path):
    rows = assign_levels(all_frame, trained)
    info = plot_density_map(rows, tmp_path / "map.png", trained.version)
    assert (tmp_path / "map.png").stat().st_size > 10_000
    assert set(info["shares"]) == set(rows["cityId"].unique())


def test_missing_coordinates_is_a_clear_error(all_frame, trained):
    with pytest.raises(ValueError, match="mid_lat"):
        assign_levels(all_frame.drop(columns=["mid_lat"]), trained)
