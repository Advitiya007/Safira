"""Comparison harness tests. Data are SYNTHETIC test fixtures (never stored anywhere)."""
import pytest

from safira_ml.compare import candidates, explain_rejections, rank, run_comparison
from safira_ml.config import TrainingParams


def _row(key, label, complexity, native=True, noise=0.0, stab=0.9, sil=0.5, transfer=0.8, nmi=0.05, db=1.0):
    return {"key": key, "label": label, "complexity": complexity, "nativePredict": native, "error": None,
            "assignFidelity": 0.99, "noiseFraction": noise, "stabilityARI": stab, "silhouette": sil,
            "transferARI": transfer, "cityNMI": nmi, "daviesBouldin": db}


def test_gates_exclude_methods_without_predict_or_with_noise_or_instability():
    rows = [_row("a", "A", 1), _row("ward", "W", 2, native=False), _row("db", "D", 3, noise=0.4),
            _row("unstable", "U", 3, stab=0.3)]
    verdict = rank(rows)
    passed = {r["key"]: r["passesAllGates"] for r in rows}
    assert passed == {"a": True, "ward": False, "db": False, "unstable": False}
    assert verdict["recommended"] == "a"


def test_parsimony_prefers_simpler_method_when_nearly_tied():
    rows = [_row("complex", "Complex", 4, sil=0.52, stab=0.92, transfer=0.9),
            _row("simple", "Simple", 1, sil=0.50, stab=0.91, transfer=0.8)]
    verdict = rank(rows)
    explain_rejections(rows, verdict["recommended"])
    assert verdict["recommended"] == "simple"
    assert "parsimony" in verdict["reason"]
    assert any("parsimony" in reason for reason in rows[0]["whyNot"])


def test_clear_winner_is_not_overridden_by_parsimony():
    rows = [_row("complex", "Complex", 4, sil=0.7, stab=0.95, transfer=0.9),
            _row("simple", "Simple", 1, sil=0.4, stab=0.8, transfer=0.5)]
    assert rank(rows)["recommended"] == "complex"


def test_no_eligible_algorithm_yields_no_recommendation():
    rows = [_row("ward", "W", 2, native=False)]
    assert rank(rows)["recommended"] is None


def test_rejection_reasons_are_data_driven():
    rows = [_row("a", "A", 1, sil=0.6, stab=0.95), _row("b", "B", 2, sil=0.3, stab=0.9)]
    verdict = rank(rows)
    explain_rejections(rows, verdict["recommended"])
    assert any("silhouette" in reason for reason in rows[1]["whyNot"])


def test_every_candidate_declares_a_plain_language_reason():
    keys = [c.key for c in candidates()]
    assert len(keys) == len(set(keys)) >= 8
    assert all(c.why for c in candidates())


@pytest.fixture(scope="module")
def report(all_frame):
    return run_comparison(all_frame, TrainingParams(k_max=4, stability_runs=2), sample_size=900,
                          stability_runs=2, only=["kmeans", "ward", "dbscan"])


def test_end_to_end_report_shape_and_structural_gates(report):
    by_key = {r["key"]: r for r in report["algorithms"]}
    assert set(by_key) == {"kmeans", "ward", "dbscan"}
    assert by_key["ward"]["gates"]["scoresNewSegments"]["passed"] is False      # no native predict
    assert by_key["kmeans"]["gates"]["scoresNewSegments"]["passed"] is True
    assert by_key["kmeans"]["noiseFraction"] == 0.0                              # K-Means never emits noise
    assert report["recommended"] in {None, "kmeans"}                             # only K-Means can qualify here
    assert "not crime predictions" in report["disclaimer"]
    assert report["data"]["cities"] == ["bathinda", "delhi", "jalandhar"]


def test_comparison_is_reproducible(all_frame):
    run = lambda: run_comparison(all_frame, TrainingParams(k_max=4), sample_size=600, stability_runs=2,
                                 only=["kmeans"])["algorithms"][0]
    first, second = run(), run()
    assert first["silhouette"] == second["silhouette"] and first["k"] == second["k"]
