"""Model evaluation: city-specific, global (balanced), and leave-one-city-out generalisation.

Everything here is *descriptive validation of a clustering* (separation, stability, how much
cluster membership is explained by city). There are no safety/crime labels, so no
accuracy-style metrics exist or are claimed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.decomposition import PCA  # noqa: E402
from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score  # noqa: E402

from .clustering import _silhouette  # noqa: E402
from .config import DISCLAIMER, ExtractionParams, TrainingParams  # noqa: E402
from .preprocessing import prepare_training_frame  # noqa: E402
from .training import TrainResult, train_model  # noqa: E402

# Okabe-Ito colour-blind-safe palette
PALETTE = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9",
           "#D55E00", "#F0E442", "#000000", "#999999", "#882255"]


# ---- plots ---------------------------------------------------------------------------

def plot_k_selection(table: pd.DataFrame, chosen_k: int, path: Path, title: str) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.8))
    axes[0].plot(table["k"], table["inertia"], marker="o", color=PALETTE[0])
    axes[0].axvline(chosen_k, color=PALETTE[5], linestyle="--", label=f"selected k={chosen_k}")
    axes[0].set(xlabel="k (clusters)", ylabel="Inertia (within-cluster SS)", title="Elbow method")
    axes[0].legend()
    axes[1].plot(table["k"], table["silhouette"], marker="o", color=PALETTE[2])
    axes[1].axvline(chosen_k, color=PALETTE[5], linestyle="--")
    axes[1].set(xlabel="k (clusters)", ylabel="Silhouette (sampled)", title="Silhouette score")
    fig.suptitle(title)
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def plot_pca(result: TrainResult, path: Path, title: str, seed: int = 42, max_points: int = 20000) -> dict:
    X, labels = result.X, result.labels
    names = result.bundle.cluster_names()
    pca = PCA(n_components=2, random_state=seed).fit(X)
    if len(X) > max_points:
        index = np.random.default_rng(seed).choice(len(X), max_points, replace=False)
    else:
        index = np.arange(len(X))
    points = pca.transform(X[index])
    fig, ax = plt.subplots(figsize=(7.2, 5.4))
    for cluster in sorted(names):
        mask = labels[index] == cluster
        ax.scatter(points[mask, 0], points[mask, 1], s=6, alpha=0.55,
                   color=PALETTE[cluster % len(PALETTE)], label=names[cluster])
    ax.set(xlabel=f"PC1 ({pca.explained_variance_ratio_[0]:.0%} variance)",
           ylabel=f"PC2 ({pca.explained_variance_ratio_[1]:.0%} variance)", title=title)
    ax.legend(markerscale=3, fontsize=8, loc="best")
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)
    return {"explainedVarianceRatio": [float(v) for v in pca.explained_variance_ratio_]}


def plot_profile_heatmap(meta: dict, path: Path, title: str) -> None:
    clusters = sorted(meta["clusters"], key=lambda c: (c["serviceIndex"] is None, c["serviceIndex"] or 0))
    features = list(clusters[0]["centroidZ"])
    matrix = np.array([[c["centroidZ"][f] for f in features] for c in clusters])
    fig, ax = plt.subplots(figsize=(max(7, len(features) * 0.8), 1.2 + 0.7 * len(clusters)))
    limit = max(1.0, float(np.abs(matrix).max()))
    image = ax.imshow(matrix, cmap="RdBu_r", vmin=-limit, vmax=limit, aspect="auto")
    ax.set_xticks(range(len(features)), features, rotation=40, ha="right", fontsize=8)
    ax.set_yticks(range(len(clusters)), [c["name"] for c in clusters], fontsize=8)
    for row in range(matrix.shape[0]):
        for col in range(matrix.shape[1]):
            value = matrix[row, col]
            ax.text(col, row, f"{value:.1f}", ha="center", va="center", fontsize=7,
                    color="white" if abs(value) > 0.6 * limit else "black")
    fig.colorbar(image, ax=ax, label="z-score")
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def plot_city_composition(composition: pd.DataFrame, names: dict, path: Path) -> None:
    fig, ax = plt.subplots(figsize=(7.5, 4))
    bottom = np.zeros(len(composition))
    for position, cluster in enumerate(composition.columns):
        values = composition[cluster].to_numpy()
        ax.bar(composition.index, values, bottom=bottom, color=PALETTE[position % len(PALETTE)],
               label=names.get(cluster, str(cluster)))
        bottom += values
    ax.set(ylabel="Share of city's segments", title="Cluster composition by city (global model)")
    ax.legend(fontsize=7, bbox_to_anchor=(1.01, 1), loc="upper left")
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


# ---- analyses ------------------------------------------------------------------------

def _summary(result: TrainResult) -> dict:
    meta = result.bundle.meta
    return {
        "modelVersion": meta["modelVersion"],
        "k": meta["k"],
        "kSelection": {key: meta["kSelection"][key] for key in ("method", "silhouetteChoice", "elbowChoice")},
        "kTable": meta["kSelection"]["table"],
        "metrics": meta["metrics"],
        "droppedFeatures": meta["features"]["droppedFeatures"],
        "featuresUsed": meta["features"]["numeric"],
        "training": meta["training"],
        "clusters": [
            {"clusterId": c["clusterId"], "name": c["name"], "size": c["size"], "share": c["share"],
             "serviceIndex": c["serviceIndex"], "cityShares": c["cityShares"]}
            for c in meta["clusters"]
        ],
    }


def city_effect_by_feature(result: TrainResult) -> dict:
    """Share of each (transformed) feature's variance explained by city (eta squared)."""
    X, cities = result.X, result.training_frame["cityId"].to_numpy()
    names = result.bundle.transformer.spec.feature_names
    out = {}
    for column, name in enumerate(names):
        values = X[:, column]
        total = float(((values - values.mean()) ** 2).sum())
        if total == 0:
            continue
        between = sum(
            float((cities == city).sum()) * (values[cities == city].mean() - values.mean()) ** 2
            for city in np.unique(cities)
        )
        out[name] = round(between / total, 4)
    return out


def leave_one_city_out(df: pd.DataFrame, held_out: str, own: TrainResult, params: TrainingParams) -> dict:
    train_df = df[df["cityId"] != held_out]
    result = train_model(train_df, "global", params)
    bundle = result.bundle
    held_clean, _ = prepare_training_frame(df[df["cityId"] == held_out], params)
    X_held, imputed = bundle.transformer.transform(held_clean)
    labels = bundle.kmeans.predict(X_held)
    distances = np.linalg.norm(X_held - bundle.kmeans.cluster_centers_[labels], axis=1)
    train_distances = np.linalg.norm(
        result.X - bundle.kmeans.cluster_centers_[result.labels], axis=1
    )
    own_labels = own.bundle.kmeans.predict(own.bundle.transformer.transform(held_clean)[0])
    shares = pd.Series(labels).value_counts(normalize=True).sort_index()
    names = bundle.cluster_names()
    return {
        "heldOutCity": held_out,
        "trainedOn": sorted(train_df["cityId"].unique()),
        "modelVersion": bundle.version,
        "k": bundle.meta["k"],
        "heldOutSegments": int(len(held_clean)),
        "heldOutSilhouette": _silhouette(X_held, labels, params.silhouette_sample, params.seed),
        "trainSilhouette": bundle.meta["metrics"]["silhouette"],
        "meanDistanceRatio": float(distances.mean() / train_distances.mean()),
        "shareAboveTrainP99": float((distances > np.quantile(train_distances, 0.99)).mean()),
        "imputedValueFraction": float(imputed.to_numpy().mean()) if imputed.size else 0.0,
        "clusterShares": {names[int(c)]: round(float(s), 4) for c, s in shares.items()},
        "agreementWithCityOwnModel": {
            "adjustedRand": float(adjusted_rand_score(own_labels, labels)),
            "normalizedMutualInfo": float(normalized_mutual_info_score(own_labels, labels)),
            "note": "Cluster counts can differ between the two models; ARI/NMI compare partitions only.",
        },
    }


def run_evaluation(
    df: pd.DataFrame,
    out_dir: Path,
    params: Optional[TrainingParams] = None,
    extraction_params: Optional[ExtractionParams] = None,
) -> dict:
    params = params or TrainingParams()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cities = sorted(df["cityId"].unique())
    report: dict = {"cities": cities, "disclaimer": DISCLAIMER, "perCity": {}, "plots": []}

    own_results: dict[str, TrainResult] = {}
    for city in cities:
        result = train_model(df, city, params, extraction_params=extraction_params)
        own_results[city] = result
        report["perCity"][city] = _summary(result)
        plot_k_selection(pd.DataFrame(result.bundle.meta["kSelection"]["table"]),
                         result.bundle.meta["k"], out_dir / f"k_selection_{city}.png", f"{city}: choosing k")
        plot_pca(result, out_dir / f"pca_{city}.png", f"{city}: clusters in PCA space", params.seed)
        plot_profile_heatmap(result.bundle.meta, out_dir / f"profiles_{city}.png", f"{city}: cluster profiles")
        report["plots"] += [f"k_selection_{city}.png", f"pca_{city}.png", f"profiles_{city}.png"]

    if len(cities) >= 2:
        global_result = train_model(df, "global", params, extraction_params=extraction_params)
        report["global"] = _summary(global_result)
        training = global_result.training_frame
        composition = pd.crosstab(training["cityId"], global_result.labels, normalize="index")
        report["global"]["cityComposition"] = {
            city: {global_result.bundle.cluster_names()[int(c)]: round(float(v), 4) for c, v in row.items()}
            for city, row in composition.iterrows()
        }
        report["global"]["varianceExplainedByCity"] = city_effect_by_feature(global_result)
        plot_k_selection(pd.DataFrame(global_result.bundle.meta["kSelection"]["table"]),
                         global_result.bundle.meta["k"], out_dir / "k_selection_global.png",
                         "global: choosing k")
        plot_pca(global_result, out_dir / "pca_global.png", "global: clusters in PCA space", params.seed)
        plot_profile_heatmap(global_result.bundle.meta, out_dir / "profiles_global.png",
                             "global: cluster profiles")
        plot_city_composition(composition, global_result.bundle.cluster_names(),
                              out_dir / "cluster_city_composition.png")
        report["plots"] += ["k_selection_global.png", "pca_global.png", "profiles_global.png",
                            "cluster_city_composition.png"]
        report["leaveOneCityOut"] = [
            leave_one_city_out(df, city, own_results[city], params) for city in cities
        ] if len(cities) >= 3 else []
        if len(cities) < 3:
            report["leaveOneCityOutNote"] = "Needs at least three cities with data."
    else:
        report["note"] = "Only one city has data; global and cross-city checks were skipped."

    (out_dir / "evaluation_report.json").write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    (out_dir / "evaluation_report.md").write_text(render_markdown(report), encoding="utf-8")
    return report


def render_markdown(report: dict) -> str:
    lines = ["# Infrastructure clustering - evaluation", "", f"> {report['disclaimer']}", ""]
    lines += ["## City-specific models", "",
              "| City | k (silhouette / elbow) | Silhouette | Davies-Bouldin | Stability (ARI) | Segments |",
              "|---|---|---|---|---|---|"]
    for city, item in report["perCity"].items():
        m = item["metrics"]
        lines.append(
            f"| {city} | {item['k']} ({item['kSelection']['silhouetteChoice']} / {item['kSelection']['elbowChoice']}) "
            f"| {m['silhouette']:.3f} | {m['daviesBouldin']:.3f} | {m['stability']['meanARI']:.3f} "
            f"| {item['training']['segmentsUsedForFitting']} |"
        )
    if "global" in report:
        g = report["global"]
        lines += ["", "## Global (cross-city) model", "",
                  f"k = {g['k']}; silhouette {g['metrics']['silhouette']:.3f}; "
                  f"cluster-vs-city NMI {g['metrics'].get('clusterCityNMI', float('nan')):.3f} "
                  "(0 = cluster membership independent of city, 1 = clusters are just cities).", "",
                  f"Features used: {', '.join(g['featuresUsed'])}.", ""]
        if g["droppedFeatures"]:
            lines.append("Dropped features: " + "; ".join(f"{k} ({v})" for k, v in g["droppedFeatures"].items()) + ".")
            lines.append("")
        lines += ["| Cluster | Segments | Service index |", "|---|---|---|"]
        for c in sorted(g["clusters"], key=lambda c: c["serviceIndex"] or 0):
            lines.append(f"| {c['name']} | {c['size']} | {c['serviceIndex']:.2f} |" if c["serviceIndex"] is not None
                         else f"| {c['name']} | {c['size']} | n/a |")
        high = {k: v for k, v in g["varianceExplainedByCity"].items() if v >= 0.1}
        if high:
            lines += ["", "Features where city explains >=10% of variance: "
                      + ", ".join(f"{k} ({v:.0%})" for k, v in high.items()) + "."]
    if report.get("leaveOneCityOut"):
        lines += ["", "## Leave-one-city-out generalisation", "",
                  "| Held-out city | Held-out silhouette | Train silhouette | Mean distance ratio | >P99 share | Imputed values | ARI vs city's own model |",
                  "|---|---|---|---|---|---|---|"]
        for r in report["leaveOneCityOut"]:
            lines.append(
                f"| {r['heldOutCity']} | {r['heldOutSilhouette']:.3f} | {r['trainSilhouette']:.3f} "
                f"| {r['meanDistanceRatio']:.2f} | {r['shareAboveTrainP99']:.1%} "
                f"| {r['imputedValueFraction']:.1%} | {r['agreementWithCityOwnModel']['adjustedRand']:.3f} |"
            )
    lines += ["", "Plots: " + ", ".join(report["plots"]), ""]
    return "\n".join(lines)
