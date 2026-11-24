"""Command line entry point:  python -m safira_ml.cli <command> ...

  extract   GeographicFeature -> road segments (road_features.csv and/or RoadSegmentFeature)
  train     fit + save a K-Means model (scope: global or a city id)
  evaluate  city-specific / global / leave-one-city-out evaluation with plots
  compare   benchmark K-Means against other clustering algorithms
  assign    write cluster assignments into RoadSegmentFeature using the saved model
  serve     run the FastAPI service
  inspect-incidents  what incident data exists / what blocks supervised training
  build-dataset      road_features.csv + incidents + coverage -> labelled supervised dataset (no training)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

from .config import SUPPORTED_CITIES, ExtractionParams, TrainingParams, data_dir, reports_dir


def _frame_from_csv(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path, low_memory=False)
    for column in ("is_short", "near_bbox_edge"):
        if column in frame:
            frame[column] = frame[column].astype(bool)
    return frame


def _training_frame(args) -> tuple[pd.DataFrame, list]:
    if args.from_csv:
        return _frame_from_csv(Path(args.from_csv)), []
    from .db import get_database
    from .store import SegmentStore
    frame = SegmentStore.from_database(get_database()).training_frame()
    return frame, frame.attrs.get("source_data_versions", [])


def cmd_extract(args) -> int:
    from .extract import (
        FileFeatureSource, MongoFeatureSource, extract_city, to_mongo_documents, write_city_csv,
    )
    params = ExtractionParams(
        max_segment_m=args.max_segment_m, min_segment_m=args.min_segment_m,
        activity_radius_m=args.activity_radius_m, emergency_radius_m=args.emergency_radius_m,
    )
    cities = list(SUPPORTED_CITIES) if args.city == "all" else [args.city]
    database = None
    if not args.file:
        from .db import get_database
        database = get_database()
    store = None
    if not args.no_mongo:
        from .db import get_database
        from .store import SegmentStore
        store = SegmentStore.from_database(database if database is not None else get_database())
        store.ensure_indexes()
    csv_path = Path(args.csv) if args.csv else data_dir() / "road_features.csv"
    for city in cities:
        source = FileFeatureSource(Path(args.file)) if args.file else MongoFeatureSource(database)
        try:
            frame, meta = extract_city(city, source.load(city), params)
        except ValueError as error:
            print(f"[{city}] skipped: {error}", file=sys.stderr)
            continue
        write_city_csv(frame, meta, csv_path)
        print(f"[{city}] {meta['counts']['segments']} segments from {meta['counts']['roadWays']} ways "
              f"(POIs: {meta['counts']['poi']}; classes mapped: "
              f"{[k for k, v in meta['classAvailability'].items() if v]}) -> {csv_path}")
        missing = [k for k, v in meta["classAvailability"].items() if not v]
        if missing:
            print(f"[{city}] WARNING no imported records for {missing}: their features are unknown (NaN), not 0.")
        if store is not None:
            print(f"[{city}] mongo:", store.upsert_city(to_mongo_documents(frame, meta), meta["runId"],
                                                          not args.keep_stale))
    return 0


def cmd_train(args) -> int:
    from .persistence import save_bundle
    from .training import train_model
    frame, versions = _training_frame(args)
    params = TrainingParams(per_city_cap=args.per_city_cap, exclude_edge_segments=args.exclude_edge,
                            seed=args.seed, k_max=args.k_max)
    result = train_model(frame, args.scope, params, args.k, source_data_versions=versions)
    path = save_bundle(result.bundle)
    meta = result.bundle.meta
    print(f"saved {meta['modelVersion']} -> {path}")
    print(f"k={meta['k']} silhouette={meta['metrics']['silhouette']:.3f} "
          f"stabilityARI={meta['metrics']['stability']['meanARI']:.3f}")
    for cluster in sorted(meta["clusters"], key=lambda c: c["serviceIndex"] or 0):
        print(f"  [{cluster['clusterId']}] {cluster['name']}: {cluster['size']} segments")
    if not args.no_assign and not args.from_csv:
        from .db import get_database
        from .store import SegmentStore
        print(SegmentStore.from_database(get_database()).assign_clusters(
            result.bundle, None if args.scope == "global" else args.scope))
    return 0


def cmd_evaluate(args) -> int:
    from .evaluation import run_evaluation
    frame, _ = _training_frame(args)
    out = Path(args.out) if args.out else reports_dir()
    params = TrainingParams(per_city_cap=args.per_city_cap, seed=args.seed, k_max=args.k_max)
    report = run_evaluation(frame, out, params)
    print(f"report written to {out}/evaluation_report.md ({len(report['plots'])} plots)")
    return 0


def cmd_compare(args) -> int:
    from .compare import plot_comparison, render_markdown, run_comparison
    import json
    frame, _ = _training_frame(args)
    out = Path(args.out) if args.out else reports_dir()
    params = TrainingParams(seed=args.seed, k_max=args.k_max)
    report = run_comparison(frame, params, args.sample, args.stability_runs,
                            args.only.split(",") if args.only else None)
    out.mkdir(parents=True, exist_ok=True)
    (out / "algorithm_comparison.json").write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    (out / "algorithm_comparison.md").write_text(render_markdown(report), encoding="utf-8")
    plot_comparison(report, out / "algorithm_comparison.png")
    print(f"recommended: {report['recommended']} - {report['recommendationReason']}")
    print(f"report written to {out}/algorithm_comparison.md")
    return 0


def cmd_assign(args) -> int:
    from .db import get_database
    from .persistence import load_bundle
    from .store import SegmentStore
    bundle = load_bundle(args.scope, args.version)
    print(SegmentStore.from_database(get_database()).assign_clusters(bundle, None if args.scope == "global" else args.scope))
    return 0


def cmd_serve(args) -> int:
    import uvicorn
    uvicorn.run("safira_ml.service.main:app", host=args.host, port=args.port, log_level="info")
    return 0


def cmd_density_map(args) -> int:
    from .density_map import assign_levels, plot_density_map
    from .persistence import load_bundle
    frame = _frame_from_csv(Path(args.from_csv))
    bundle = load_bundle(args.scope, args.version)
    rows = assign_levels(frame, bundle)
    out = Path(args.out) if args.out else reports_dir()
    out.mkdir(parents=True, exist_ok=True)
    info = plot_density_map(rows, out / "infrastructure_density_map.png", bundle.version)
    print(f"written {info['path']}")
    print(info["shares"])
    return 0


def cmd_inspect_incidents(args) -> int:
    import json as _json
    from .risk.inspect import inspect_incident_data, render_text
    report = inspect_incident_data(Path(args.dir) if args.dir else None)
    print(_json.dumps(report, indent=2, default=str) if args.json else render_text(report))
    return 0 if report["trainable"] else 3


def cmd_build_dataset(args) -> int:
    from dataclasses import replace
    from .risk.adapters import BackendIncidentSource, FileIncidentSource
    from .risk.config import INCIDENT_DIR, RiskConfig
    from .risk.coverage import CoverageError, load_coverage
    from .risk.dataset import DatasetBuildError, build_dataset

    config = replace(RiskConfig(), label_radius_m=args.radius, match_mode=args.match_mode)
    incident_dir = Path(args.dir) if args.dir else INCIDENT_DIR
    try:
        if args.backend_export or args.mongo_collection:
            field_map = json.loads(Path(args.field_map).read_text(encoding="utf-8")) if args.field_map else None
            if args.mongo_collection:
                from .db import get_database
                source = BackendIncidentSource.from_database(get_database(), args.mongo_collection, field_map=field_map)
            else:
                source = BackendIncidentSource.from_jsonl(Path(args.backend_export), field_map=field_map)
            windows = load_coverage(incident_dir)      # coverage is always declared in coverage.json
        else:
            source, windows = FileIncidentSource(incident_dir), None
        result = build_dataset(Path(args.features) if args.features else data_dir() / "road_features.csv",
                               source, Path(args.out) if args.out else None, config, windows)
    except (DatasetBuildError, CoverageError, ValueError) as exc:
        print(f"build-dataset failed: {exc}", file=sys.stderr)
        return 2
    manifest = result.manifest
    print(f"dataset {manifest['datasetId']} ({manifest['dataOrigin']}) -> {result.dataset_dir}")
    o = manifest["observations"]
    print(f"rows {o['rowsWritten']}  positive {o['positive']} (training-eligible {o['positiveTrainingEligible']})  "
          f"negative {o['negative']}  unlabelled {o['unlabelled']}")
    print("TRAINABLE: " + ("yes" if result.trainable else "NO"))
    for blocker in manifest["blockers"]:
        print(f"  - {blocker}")
    return 0 if result.trainable else 3


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="safira_ml", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("extract", help="build road-segment features")
    p.add_argument("--city", required=True, choices=[*SUPPORTED_CITIES, "all"])
    p.add_argument("--file", help="JSONL of GeographicFeature-shaped documents instead of MongoDB")
    p.add_argument("--csv", help="output CSV (default data/road_features.csv)")
    p.add_argument("--no-mongo", action="store_true", help="skip writing RoadSegmentFeature")
    p.add_argument("--keep-stale", action="store_true", help="keep segments from older extraction runs")
    p.add_argument("--max-segment-m", type=float, default=200.0)
    p.add_argument("--min-segment-m", type=float, default=20.0)
    p.add_argument("--activity-radius-m", type=float, default=200.0)
    p.add_argument("--emergency-radius-m", type=float, default=1000.0)
    p.set_defaults(func=cmd_extract)

    p = sub.add_parser("train", help="train and save a model")
    p.add_argument("--scope", default="global", help="'global' or a city id")
    p.add_argument("--k", type=int, help="force k (default: chosen from silhouette, reported with elbow)")
    p.add_argument("--k-max", type=int, default=10)
    p.add_argument("--from-csv", help="train from road_features.csv instead of MongoDB")
    p.add_argument("--per-city-cap", type=int, default=20000)
    p.add_argument("--exclude-edge", action="store_true", help="drop segments near the city bbox edge")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--no-assign", action="store_true", help="do not write assignments to MongoDB")
    p.set_defaults(func=cmd_train)

    p = sub.add_parser("evaluate", help="city-specific, global and leave-one-city-out evaluation")
    p.add_argument("--from-csv")
    p.add_argument("--out")
    p.add_argument("--k-max", type=int, default=10)
    p.add_argument("--per-city-cap", type=int, default=20000)
    p.add_argument("--seed", type=int, default=42)
    p.set_defaults(func=cmd_evaluate)

    p = sub.add_parser("compare", help="compare K-Means with other clustering algorithms")
    p.add_argument("--from-csv")
    p.add_argument("--out")
    p.add_argument("--k-max", type=int, default=8)
    p.add_argument("--sample", type=int, default=4000, help="city-balanced rows used (Ward/spectral are O(n^2))")
    p.add_argument("--stability-runs", type=int, default=4)
    p.add_argument("--only", help="comma-separated algorithm keys, e.g. kmeans,ward")
    p.add_argument("--seed", type=int, default=42)
    p.set_defaults(func=cmd_compare)

    p = sub.add_parser("density-map", help="PNG map of mapped-infrastructure density (not a safety map)")
    p.add_argument("--from-csv", required=True, help="road_features.csv from `extract`")
    p.add_argument("--scope", default="global")
    p.add_argument("--version")
    p.add_argument("--out")
    p.set_defaults(func=cmd_density_map)

    p = sub.add_parser("inspect-incidents", help="report available incident data and what is missing for supervised training")
    p.add_argument("--dir", help="incident directory (default ml_service/data/incidents)")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_inspect_incidents)

    p = sub.add_parser("build-dataset", help="build the labelled supervised dataset (does not train anything)")
    p.add_argument("--features", help="road_features.csv (default ml_service/data/road_features.csv)")
    p.add_argument("--dir", help="incident directory holding incidents + coverage.json (default data/incidents)")
    p.add_argument("--out", help="output root (default ml_service/data/datasets)")
    p.add_argument("--radius", type=float, default=100.0, help="match radius in metres (default 100)")
    p.add_argument("--match-mode", choices=["radius", "nearest"], default="radius")
    p.add_argument("--backend-export", help="JSONL export of backend incident reports (see risk/adapters.py)")
    p.add_argument("--mongo-collection", help="backend incident-report collection (must be named explicitly)")
    p.add_argument("--field-map", help="JSON overriding backend field names")
    p.set_defaults(func=cmd_build_dataset)

    p = sub.add_parser("assign", help="write cluster assignments into RoadSegmentFeature")
    p.add_argument("--scope", default="global")
    p.add_argument("--version")
    p.set_defaults(func=cmd_assign)

    p = sub.add_parser("serve", help="run the FastAPI service")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8001)
    p.set_defaults(func=cmd_serve)
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
