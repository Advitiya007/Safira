"""PNG map of mapped-infrastructure density, from the SAVED model's cluster assignments.

This is a descriptive picture of how much *mapped* infrastructure surrounds each road segment
(clusters are ordered by the model's own service index). It is NOT a safety map: there are no
safety labels, sparse mapping looks identical to sparse infrastructure, and nothing here feeds
route scores. One sequential hue (dark = more mapped infrastructure); no red/green.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from .config import DISCLAIMER  # noqa: E402
from .persistence import ModelBundle  # noqa: E402

LEVEL_ORDER = ["Infrastructure-sparse", "Mixed infrastructure", "Moderate infrastructure", "Infrastructure-rich"]
# Light -> dark single-hue ramp (sequential = magnitude of mapped infrastructure).
LEVEL_COLORS = {
    "Infrastructure-sparse": "#d6e6f4",
    "Mixed infrastructure": "#a3c4e0",
    "Moderate infrastructure": "#5b94c4",
    "Infrastructure-rich": "#12457a",
}


def assign_levels(frame: pd.DataFrame, bundle: ModelBundle) -> pd.DataFrame:
    """Return the usable rows with a `level` column, using the saved model (never refits)."""
    needed = {"mid_lat", "mid_lon"}
    if not needed <= set(frame.columns):
        raise ValueError("frame needs mid_lat and mid_lon columns (use the extract CSV)")
    rows = frame[~frame.get("is_short", False).astype(bool)] if "is_short" in frame else frame
    rows = rows.dropna(subset=["mid_lat", "mid_lon"]).copy()
    if rows.empty:
        raise ValueError("no segments with coordinates to plot")
    prediction = bundle.predict(rows)
    level_by_cluster = {c["clusterId"]: c["level"] for c in bundle.meta["clusters"]}
    rows["cluster_id"] = prediction["cluster_id"].to_numpy()
    rows["level"] = [level_by_cluster[int(c)] for c in rows["cluster_id"]]
    return rows


def level_shares(rows: pd.DataFrame) -> pd.DataFrame:
    table = pd.crosstab(rows["cityId"], rows["level"], normalize="index") * 100
    cols = [level for level in LEVEL_ORDER if level in table.columns]
    return table.reindex(columns=cols, fill_value=0.0).round(1)


def plot_density_map(rows: pd.DataFrame, path: Path, model_version: str, max_points: int = 60000) -> dict:
    cities = sorted(rows["cityId"].unique())
    shares = level_shares(rows)
    fig = plt.figure(figsize=(5.2 * len(cities), 8.2))
    grid = fig.add_gridspec(2, len(cities), height_ratios=[4, 1.3])
    for column, city in enumerate(cities):
        ax = fig.add_subplot(grid[0, column])
        part = rows[rows["cityId"] == city]
        if len(part) > max_points:
            part = part.sample(max_points, random_state=0)
        # Draw sparse first so denser levels sit on top and stay visible.
        for level in LEVEL_ORDER:
            sel = part[part["level"] == level]
            if len(sel):
                ax.scatter(sel["mid_lon"], sel["mid_lat"], s=7, c=LEVEL_COLORS[level], linewidths=0, label=level)
        ax.set_title(f"{city.title()}  ({len(rows[rows['cityId'] == city]):,} segments)", fontsize=10)
        ax.set_aspect(1 / max(np.cos(np.radians(part["mid_lat"].mean())), 0.2))
        ax.tick_params(labelsize=7)
        ax.set_xlabel("longitude", fontsize=8)
        if column == 0:
            ax.set_ylabel("latitude", fontsize=8)
    bar = fig.add_subplot(grid[1, :])
    left = np.zeros(len(shares))
    for level in shares.columns:
        values = shares[level].to_numpy()
        bar.barh(shares.index.str.title(), values, left=left, color=LEVEL_COLORS[level],
                 edgecolor="white", linewidth=1.5, label=level)
        for y, (start, value) in enumerate(zip(left, values)):
            if value >= 6:
                bar.text(start + value / 2, y, f"{value:.0f}%", ha="center", va="center", fontsize=8,
                         color="white" if level in ("Infrastructure-rich", "Moderate infrastructure") else "#222")
        left += values
    bar.set_xlim(0, 100)
    bar.set_xlabel("share of road segments (%)", fontsize=8)
    bar.tick_params(labelsize=8)
    handles, labels = bar.get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", bbox_to_anchor=(0.5, 0.94), ncol=len(labels), fontsize=8, frameon=False,
               title="Mapped infrastructure around each segment (darker = more mapped)", title_fontsize=9)
    fig.suptitle("Mapped infrastructure density (descriptive; NOT a safety rating)", y=0.985, fontsize=12)
    fig.text(0.5, 0.005, f"Model {model_version}. {DISCLAIMER}", ha="center", fontsize=6.5, wrap=True)
    fig.tight_layout(rect=(0, 0.03, 1, 0.87))
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return {"path": str(path), "shares": shares.to_dict(orient="index")}
