"""Compare clustering algorithms on the SAME preprocessed road-segment data.

There are no safety/crime labels, so no algorithm can be scored on "accuracy". Instead each is
judged on (a) requirements the application actually has (hard gates) and (b) data-driven
quality signals, then ranked. All numbers come from the data you pass in.

Honest caveats baked into the report:
  * silhouette / Davies-Bouldin favour compact round clusters, i.e. they are biased towards
    K-Means-like methods. Stability, city-independence and cross-city transfer are fairer.
  * the comparison runs on a city-balanced subsample (``sample_size``) because Ward and
    spectral clustering are O(n^2).
  * on synthetic test data the result only proves the harness works, not which algorithm is best.
"""

from __future__ import annotations

import time
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.cluster import (  # noqa: E402
    DBSCAN, HDBSCAN, AgglomerativeClustering, Birch, BisectingKMeans, KMeans,
    MiniBatchKMeans, SpectralClustering,
)
from sklearn.metrics import (  # noqa: E402
    adjusted_rand_score, calinski_harabasz_score, davies_bouldin_score,
    normalized_mutual_info_score,
)
from sklearn.mixture import GaussianMixture  # noqa: E402
from sklearn.neighbors import NearestCentroid, NearestNeighbors  # noqa: E402

from .clustering import _silhouette  # noqa: E402
from .config import DISCLAIMER, TrainingParams  # noqa: E402
from .preprocessing import FittedTransformer, default_spec, prepare_training_frame, select_model_features  # noqa: E402
from .training import balanced_sample  # noqa: E402

# ---- thresholds (the rules; change them here, they are printed in the report) -----------
MAX_NOISE_FRACTION = 0.05      # every segment should receive a profile
MIN_ASSIGN_FIDELITY = 0.95     # saved model must reproduce its own labels on new data
MIN_STABILITY_ARI = 0.60       # common rule of thumb for "reasonably reproducible"
PARSIMONY_TOLERANCE = 0.03     # a simpler method within this of the winner (silhouette AND stability) wins
RANK_METRICS = (               # (metric key, higher_is_better)
    ("silhouette", True), ("stabilityARI", True), ("transferARI", True),
    ("cityNMI", False), ("daviesBouldin", False),
)


@dataclass(frozen=True)
class Candidate:
    key: str
    label: str
    complexity: int          # 1 = fewest assumptions; used only for the parsimony tie-break
    needs_k: bool
    native_predict: bool     # can score brand-new segments with the fitted object itself
    build: Optional[Callable] = None   # build(k, seed) -> estimator (None for density methods)
    why: str = ""            # structural, data-independent reason in plain language


def candidates() -> list[Candidate]:
    return [
        Candidate("kmeans", "K-Means", 1, True, True, lambda k, s: KMeans(k, n_init=10, random_state=s),
                  "Simple, fast, has one centre per cluster, scores new segments by nearest centre."),
        Candidate("minibatch_kmeans", "MiniBatch K-Means", 1, True, True,
                  lambda k, s: MiniBatchKMeans(k, n_init=10, batch_size=1024, random_state=s),
                  "Same idea as K-Means but approximate; only worth it for millions of rows."),
        Candidate("bisecting_kmeans", "Bisecting K-Means", 2, True, True,
                  lambda k, s: BisectingKMeans(n_clusters=k, random_state=s),
                  "Splits clusters top-down; gives a hierarchy but is rarely better than plain K-Means."),
        Candidate("gmm_diag", "Gaussian Mixture (diagonal)", 3, True, True,
                  lambda k, s: GaussianMixture(k, covariance_type="diag", reg_covar=1e-4, n_init=3, random_state=s),
                  "Soft membership and elliptical clusters, but assumes bell-shaped data; our counts and "
                  "0/1 columns are not bell-shaped."),
        Candidate("gmm_full", "Gaussian Mixture (full)", 4, True, True,
                  lambda k, s: GaussianMixture(k, covariance_type="full", reg_covar=1e-4, n_init=3, random_state=s),
                  "Most flexible shapes but many parameters per cluster; unstable and slow with lumpy, "
                  "discrete features."),
        Candidate("birch", "Birch", 3, True, True,
                  lambda k, s: Birch(n_clusters=k, threshold=0.5),
                  "Fast single-pass summary tree; result depends on data order and a distance threshold."),
        Candidate("ward", "Agglomerative (Ward)", 2, True, False,
                  lambda k, s: AgglomerativeClustering(n_clusters=k, linkage="ward"),
                  "Good quality but has no 'predict': new segments cannot be scored without bolting on a "
                  "second model, and it needs memory that grows with the square of the data."),
        Candidate("spectral", "Spectral", 4, True, False,
                  lambda k, s: SpectralClustering(n_clusters=k, affinity="nearest_neighbors", n_neighbors=15,
                                                  assign_labels="kmeans", random_state=s),
                  "Finds odd-shaped groups, but has no 'predict' and is slow and memory-hungry on a full road network."),
        Candidate("dbscan", "DBSCAN", 3, False, False, None,
                  "Finds dense regions and calls everything else 'noise'. Road infrastructure is a smooth "
                  "gradient, not islands, and we need a profile for every segment."),
        Candidate("hdbscan", "HDBSCAN", 3, False, False, None,
                  "Like DBSCAN but with variable density; still labels points as noise and has no predict."),
    ]


# ---- fitting helpers ---------------------------------------------------------------------

def _fit_density(key: str, X: np.ndarray, seed: int) -> tuple[np.ndarray, dict]:
    """Small, transparent parameter search for the density methods (they have no k)."""
    if key == "hdbscan":
        best = None
        for min_size in (25, 50, 100):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                labels = HDBSCAN(min_cluster_size=min_size, copy=True).fit_predict(X)
            score = _score_density(X, labels, seed)
            if best is None or score > best[0]:
                best = (score, labels, {"min_cluster_size": min_size})
        return best[1], best[2]
    min_samples = 10
    distances = NearestNeighbors(n_neighbors=min_samples).fit(X).kneighbors(X)[0][:, -1]
    best = None
    for quantile in (0.5, 0.7, 0.85, 0.95):
        eps = float(np.quantile(distances, quantile))
        labels = DBSCAN(eps=eps, min_samples=min_samples).fit_predict(X)
        score = _score_density(X, labels, seed)
        if best is None or score > best[0]:
            best = (score, labels, {"eps": round(eps, 3), "min_samples": min_samples})
    return best[1], best[2]


def _score_density(X: np.ndarray, labels: np.ndarray, seed: int) -> float:
    """Pick density parameters by silhouette, penalising noise so 'everything is noise' cannot win."""
    mask = labels >= 0
    if mask.sum() < 10 or len(np.unique(labels[mask])) < 2:
        return -1.0
    return _silhouette(X[mask], labels[mask], 3000, seed) * mask.mean()


def _fit(cand: Candidate, X: np.ndarray, k: Optional[int], seed: int, density_params: Optional[dict] = None):
    """Return (estimator-or-None, labels). Density methods reuse the parameters found on the full sample."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if cand.build is not None:
            estimator = cand.build(k, seed)
            return estimator, np.asarray(estimator.fit_predict(X))
        if density_params is None:
            labels, _ = _fit_density(cand.key, X, seed)
            return None, labels
        model = (HDBSCAN(copy=True, **density_params) if cand.key == "hdbscan" else DBSCAN(**density_params))
        return None, np.asarray(model.fit_predict(X))


def _assign(cand: Candidate, estimator, X_train, labels_train, X_new) -> np.ndarray:
    """Native predict when the method has one, otherwise the standard 'surrogate' nearest-centroid."""
    if cand.native_predict and estimator is not None:
        return np.asarray(estimator.predict(X_new))
    mask = labels_train >= 0
    if len(np.unique(labels_train[mask])) < 2:
        return np.full(len(X_new), -1)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return NearestCentroid().fit(X_train[mask], labels_train[mask]).predict(X_new)


def _internal(X: np.ndarray, labels: np.ndarray, seed: int) -> dict:
    mask = labels >= 0
    clusters = np.unique(labels[mask])
    out = {"nClusters": int(len(clusters)), "noiseFraction": float(1 - mask.mean()),
           "minClusterFraction": None, "silhouette": None, "daviesBouldin": None, "calinskiHarabasz": None}
    if len(clusters) >= 2 and mask.sum() > len(clusters):
        Xm, lm = X[mask], labels[mask]
        out["minClusterFraction"] = float(np.bincount(np.searchsorted(clusters, lm)).min() / len(lm))
        out["silhouette"] = _silhouette(Xm, lm, 3000, seed)
        out["daviesBouldin"] = float(davies_bouldin_score(Xm, lm))
        out["calinskiHarabasz"] = float(calinski_harabasz_score(Xm, lm))
    return out


def _choose_k(cand: Candidate, X: np.ndarray, params: TrainingParams) -> tuple[int, list]:
    """Same rule used for production K-Means: best silhouette among k without a tiny cluster."""
    rows = []
    for k in range(params.k_min, min(params.k_max, max(2, len(X) // 50)) + 1):
        try:
            _, labels = _fit(cand, X, k, params.seed)
        except Exception:  # noqa: BLE001 - a method failing at some k is a result, not a crash
            continue
        m = _internal(X, labels, params.seed)
        if m["silhouette"] is not None:
            rows.append({"k": k, "silhouette": m["silhouette"], "minClusterFraction": m["minClusterFraction"]})
    if not rows:
        raise RuntimeError("no valid k")
    pool = [r for r in rows if r["minClusterFraction"] >= params.min_cluster_fraction] or rows
    best = sorted(pool, key=lambda r: (-r["silhouette"], r["k"]))[0]
    return best["k"], rows


def _stability(cand, X, k, density_params, params, runs) -> Optional[float]:
    """ARI between fits on two overlapping 70% subsamples, compared on the points they share."""
    rng = np.random.default_rng(params.seed)
    scores = []
    for _ in range(runs):
        a = np.sort(rng.choice(len(X), int(len(X) * 0.7), replace=False))
        b = np.sort(rng.choice(len(X), int(len(X) * 0.7), replace=False))
        common = np.intersect1d(a, b)
        try:
            _, la = _fit(cand, X[a], k, params.seed + 1, density_params)
            _, lb = _fit(cand, X[b], k, params.seed + 2, density_params)
        except Exception:  # noqa: BLE001
            continue
        sa, sb = pd.Series(la, index=a), pd.Series(lb, index=b)
        scores.append(adjusted_rand_score(sa.loc[common], sb.loc[common]))
    return float(np.mean(scores)) if scores else None


def _transfer(cand, X, cities, k, density_params, params) -> dict:
    """Leave-one-city-out: fit on other cities, label the held-out city, compare with its own fit."""
    aris, sils = [], []
    for held in sorted(set(cities)):
        test = cities == held
        if test.sum() < 100 or (~test).sum() < 200:
            continue
        try:
            est, labels_train = _fit(cand, X[~test], k, params.seed, density_params)
            transferred = _assign(cand, est, X[~test], labels_train, X[test])
            _, own = _fit(cand, X[test], k, params.seed, density_params)
        except Exception:  # noqa: BLE001
            continue
        aris.append(adjusted_rand_score(own, transferred))
        keep = transferred >= 0
        if keep.sum() > 10 and len(np.unique(transferred[keep])) >= 2:
            sils.append(_silhouette(X[test][keep], transferred[keep], 3000, params.seed))
    return {"transferARI": float(np.mean(aris)) if aris else None,
            "transferSilhouette": float(np.mean(sils)) if sils else None, "heldOutCities": len(aris)}


def evaluate_candidate(cand: Candidate, X: np.ndarray, cities: np.ndarray, params: TrainingParams,
                       stability_runs: int) -> dict:
    result = {"key": cand.key, "label": cand.label, "nativePredict": cand.native_predict, "why": cand.why,
              "complexity": cand.complexity, "error": None}
    try:
        density_params, k_table = None, []
        if cand.needs_k:
            k, k_table = _choose_k(cand, X, params)
        else:
            k = None
        start = time.perf_counter()
        estimator, labels = _fit(cand, X, k, params.seed)
        if not cand.needs_k:
            _, density_params = _fit_density(cand.key, X, params.seed)
        result["fitSeconds"] = round(time.perf_counter() - start, 3)
        result["k"] = k
        result["densityParams"] = density_params
        result["kCurve"] = k_table
        result.update(_internal(X, labels, params.seed))
        kept = labels >= 0
        result["cityNMI"] = (float(normalized_mutual_info_score(cities[kept], labels[kept]))
                             if len(np.unique(labels[kept])) >= 2 else None)
        own_labels = _assign(cand, estimator, X, labels, X)
        result["assignFidelity"] = float((own_labels == labels).mean())
        result["stabilityARI"] = _stability(cand, X, k, density_params, params, stability_runs)
        result.update(_transfer(cand, X, cities, k, density_params, params))
    except Exception as error:  # noqa: BLE001
        result["error"] = f"{type(error).__name__}: {error}"
    return result


# ---- ranking and explanation -------------------------------------------------------------

def _gates(row: dict) -> dict:
    """Hard requirements of the SafeHer use case. Each entry: (passed, explanation)."""
    if row.get("error"):
        return {"ran": (False, row["error"])}
    gates = {}
    fidelity = row.get("assignFidelity")
    ok = row["nativePredict"] and fidelity is not None and fidelity >= MIN_ASSIGN_FIDELITY
    if not row["nativePredict"]:
        text = ("has no native predict: a saved model could not score new segments by itself, so "
                "production would need a second 'surrogate' model on top")
        if fidelity is not None:
            text += (f" (in this run the surrogate matched the algorithm's own labels for {fidelity:.0%} "
                     "of segments, so the problem is structural, not accuracy)")
    else:
        text = f"scores new segments with the saved model (reproduces its own labels {fidelity:.0%})"
    gates["scoresNewSegments"] = (bool(ok), text)
    noise = row["noiseFraction"]
    gates["everySegmentProfiled"] = (noise <= MAX_NOISE_FRACTION,
                                     f"{noise:.0%} of segments left as 'noise' (limit {MAX_NOISE_FRACTION:.0%})")
    stability = row.get("stabilityARI")
    gates["reproducible"] = (stability is not None and stability >= MIN_STABILITY_ARI,
                             "stability ARI " + ("n/a" if stability is None else f"{stability:.2f}")
                             + f" (minimum {MIN_STABILITY_ARI:.2f})")
    return gates


def rank(rows: list[dict]) -> dict:
    for row in rows:
        row["gates"] = {name: {"passed": ok, "detail": text} for name, (ok, text) in _gates(row).items()}
        row["passesAllGates"] = all(g["passed"] for g in row["gates"].values())
    eligible = [r for r in rows if r["passesAllGates"]]
    for key, higher in RANK_METRICS:
        values = {r["key"]: r.get(key) for r in rows if r.get(key) is not None and not r.get("error")}
        ordered = sorted(values, key=lambda name: values[name], reverse=higher)
        for position, name in enumerate(ordered, start=1):
            next(r for r in rows if r["key"] == name).setdefault("ranks", {})[key] = position
    for row in rows:
        ranks = row.get("ranks", {})
        row["meanRank"] = float(np.mean([ranks[k] for k, _ in RANK_METRICS if k in ranks])) if ranks else None
    if not eligible:
        return {"recommended": None, "reason": "No algorithm passed every requirement; see gate details."}
    winner = min(eligible, key=lambda r: (r["meanRank"], r["complexity"]))
    reason = f"lowest average rank ({winner['meanRank']:.2f}) among algorithms that pass every requirement"
    simpler = [r for r in eligible if r["complexity"] < winner["complexity"]
               and r.get("silhouette") is not None and winner.get("silhouette") is not None
               and abs(r["silhouette"] - winner["silhouette"]) <= PARSIMONY_TOLERANCE
               and abs((r.get("stabilityARI") or 0) - (winner.get("stabilityARI") or 0)) <= PARSIMONY_TOLERANCE]
    if simpler:
        choice = min(simpler, key=lambda r: (r["complexity"], r["meanRank"]))
        reason = (f"{winner['label']} ranked first, but {choice['label']} is within {PARSIMONY_TOLERANCE} on "
                  "silhouette and stability and is simpler, so the simpler method is recommended (parsimony rule)")
        winner = choice
    return {"recommended": winner["key"], "reason": reason}


def explain_rejections(rows: list[dict], recommended: Optional[str]) -> None:
    best = next((r for r in rows if r["key"] == recommended), None)
    for row in rows:
        if row["key"] == recommended:
            row["whyNot"] = None
            continue
        reasons = [g["detail"] for g in row.get("gates", {}).values() if not g["passed"]]
        if best and not row.get("error"):
            for key, higher in RANK_METRICS:
                a, b = row.get(key), best.get(key)
                if a is None or b is None:
                    continue
                worse = (a < b - 0.03) if higher else (a > b + 0.03)
                if worse:
                    reasons.append(f"{key} {a:.2f} vs {b:.2f} for {best['label']}")
        if not reasons and best and row.get("meanRank") is not None and row["meanRank"] <= (best.get("meanRank") or 99):
            reasons = [f"Ranked first or tied on average rank, but is within {PARSIMONY_TOLERANCE} of "
                       f"{best['label']} on silhouette and stability and is more complex, so the simpler "
                       "method was preferred (parsimony rule)."]
        row["whyNot"] = reasons or ["Passed all requirements but ranked lower overall."]


# ---- orchestration ---------------------------------------------------------------------

def run_comparison(df: pd.DataFrame, params: Optional[TrainingParams] = None, sample_size: int = 4000,
                   stability_runs: int = 4, only: Optional[list] = None) -> dict:
    params = params or TrainingParams()
    cleaned, exclusions = prepare_training_frame(df, params)
    numeric, dropped = select_model_features(cleaned, params)
    cities = sorted(cleaned["cityId"].unique())
    sample = balanced_sample(cleaned, max(100, sample_size // max(1, len(cities))), params.seed)
    transformer = FittedTransformer.fit(sample, default_spec(numeric))
    X, _ = transformer.transform(sample)
    city_labels = sample["cityId"].to_numpy()

    rows = [evaluate_candidate(c, X, city_labels, params, stability_runs)
            for c in candidates() if not only or c.key in only]
    verdict = rank(rows)
    explain_rejections(rows, verdict["recommended"])
    return {
        "disclaimer": DISCLAIMER,
        "data": {"segmentsUsed": int(len(sample)), "cities": cities, "features": numeric,
                 "droppedFeatures": dropped, "exclusions": exclusions},
        "rules": {"maxNoiseFraction": MAX_NOISE_FRACTION, "minAssignFidelity": MIN_ASSIGN_FIDELITY,
                  "minStabilityARI": MIN_STABILITY_ARI, "parsimonyTolerance": PARSIMONY_TOLERANCE,
                  "rankedMetrics": [k for k, _ in RANK_METRICS]},
        "recommended": verdict["recommended"], "recommendationReason": verdict["reason"],
        "algorithms": rows,
    }


def _fmt(value, digits=2, pct=False):
    if value is None:
        return "n/a"
    return f"{value:.0%}" if pct else f"{value:.{digits}f}"


def render_markdown(report: dict, synthetic: bool = False) -> str:
    lines = ["# Clustering algorithm comparison", ""]
    if synthetic:
        lines += ["> **SYNTHETIC DEMO DATA.** This run only proves the comparison harness works. "
                  "It says nothing about which algorithm is best on real Safira data - re-run on your own.", ""]
    lines += [report["disclaimer"], "",
              f"Data: {report['data']['segmentsUsed']} road segments (city-balanced subsample) from "
              f"{', '.join(report['data']['cities'])}; features: {', '.join(report['data']['features'])}.", "",
              "## Requirements an algorithm must meet (gates)", "",
              "1. **Scores new segments with the saved model** (native `predict`, reproduces its own labels).",
              f"2. **Every segment gets a profile** (noise <= {MAX_NOISE_FRACTION:.0%}).",
              f"3. **Reproducible** (stability ARI >= {MIN_STABILITY_ARI}).", "",
              "Survivors are ranked by average rank on: silhouette, stability, cross-city transfer, "
              "low city-dependence (NMI), Davies-Bouldin. If a simpler method is within "
              f"{PARSIMONY_TOLERANCE} of the winner, the simpler one is recommended.", "",
              "## Results", "",
              "| Algorithm | k | Silhouette | Stability (ARI) | Cross-city transfer (ARI) | City NMI (lower=better) "
              "| Noise | Native predict | Fit s | Passes gates | Avg rank |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in sorted(report["algorithms"], key=lambda r: (r.get("meanRank") is None, r.get("meanRank") or 99)):
        k = r.get("k") if r.get("k") is not None else (r.get("nClusters") or "auto")
        lines.append(
            f"| {r['label']}{' **(recommended)**' if r['key'] == report['recommended'] else ''} | {k} | "
            f"{_fmt(r.get('silhouette'))} | {_fmt(r.get('stabilityARI'))} | {_fmt(r.get('transferARI'))} | "
            f"{_fmt(r.get('cityNMI'))} | {_fmt(r.get('noiseFraction'), pct=True)} | "
            f"{'yes' if r['nativePredict'] else 'no'} | {_fmt(r.get('fitSeconds'), 1)} | "
            f"{'yes' if r.get('passesAllGates') else 'no'} | {_fmt(r.get('meanRank'))} |")
    lines += ["", "## Recommendation", "",
              f"**{next((r['label'] for r in report['algorithms'] if r['key'] == report['recommended']), 'none')}**"
              f" - {report['recommendationReason']}.", "", "## Why the others were not chosen", ""]
    for r in report["algorithms"]:
        if r["key"] == report["recommended"]:
            continue
        lines += [f"**{r['label']}** - {r['why']}", ""]
        lines += [f"- {reason}" for reason in (r.get("whyNot") or [])] + [""]
    lines += ["## Reading this fairly", "",
              "- Silhouette and Davies-Bouldin reward round, compact clusters, which favours K-Means-style "
              "methods. Stability, city NMI and cross-city transfer do not share that bias.",
              "- Near-ties are expected between K-Means, MiniBatch and Bisecting K-Means; differences of a few "
              "hundredths are not meaningful.",
              "- DBSCAN/HDBSCAN silhouettes are computed ONLY on the points they kept. A method that discards "
              "many segments as 'noise' can look well separated; check its Noise column before comparing.",
              "- No metric here measures safety; there are no safety labels."]
    return "\n".join(lines) + "\n"


def plot_comparison(report: dict, path: Path) -> None:
    rows = [r for r in report["algorithms"] if not r.get("error") and r.get("silhouette") is not None]
    panels = [("silhouette", "Silhouette (higher = better separated)"),
              ("stabilityARI", "Stability, ARI (higher = more reproducible)"),
              ("transferARI", "Cross-city transfer, ARI (higher = generalises)"),
              ("cityNMI", "City dependence, NMI (LOWER = better)")]
    order = sorted(rows, key=lambda r: r.get("meanRank") or 99)
    names = [r["label"] for r in order]
    fig, axes = plt.subplots(1, 4, figsize=(15, 0.55 * len(order) + 1.8), sharey=True)
    for ax, (key, title) in zip(axes, panels):
        values = [r.get(key) if r.get(key) is not None else 0 for r in order]
        colors = ["#0072B2" if r["key"] == report["recommended"] else
                  ("#9AA5B1" if r.get("passesAllGates") else "#D3D8DE") for r in order]
        ax.barh(range(len(order)), values, color=colors, height=0.62)
        for i, (r, v) in enumerate(zip(order, values)):
            ax.text(v + 0.01, i, _fmt(r.get(key)), va="center", fontsize=8, color="#374151")
        ax.set_title(title, fontsize=9, loc="left")
        ax.set_xlim(0, max(1.0, max(values) * 1.2))
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
        ax.tick_params(labelsize=8)
    axes[0].set_yticks(range(len(order)), names)
    axes[0].invert_yaxis()   # once: axes are shared, so best-ranked method is at the top
    fig.suptitle("Blue = recommended, grey = passes all requirements, light grey = fails a requirement",
                 fontsize=9, x=0.01, ha="left")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
