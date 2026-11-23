import json

from safira_ml.evaluation import run_evaluation


def test_full_evaluation_writes_report_and_plots(all_frame, params, tmp_path):
    report = run_evaluation(all_frame, tmp_path, params)
    assert set(report["perCity"]) == {"jalandhar", "bathinda", "delhi"}
    assert {"global", "leaveOneCityOut"} <= set(report)
    assert len(report["leaveOneCityOut"]) == 3
    loco = {r["heldOutCity"]: r for r in report["leaveOneCityOut"]}
    assert loco["bathinda"]["imputedValueFraction"] >= 0          # reported, never hidden
    assert "adjustedRand" in loco["delhi"]["agreementWithCityOwnModel"]
    assert "clusterCityNMI" in report["global"]["metrics"]
    assert report["global"]["varianceExplainedByCity"]
    for name in report["plots"]:
        assert (tmp_path / name).stat().st_size > 2000, name
    assert (tmp_path / "evaluation_report.md").read_text().startswith("# Infrastructure clustering")
    assert json.loads((tmp_path / "evaluation_report.json").read_text())["cities"]


def test_single_city_skips_cross_city_checks(all_frame, params, tmp_path):
    report = run_evaluation(all_frame[all_frame.cityId == "delhi"], tmp_path, params)
    assert "global" not in report and "note" in report
