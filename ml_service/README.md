# Safira infrastructure clustering service (`ml_service`)

An **unsupervised** K-Means pipeline that groups road segments by the *mapped* infrastructure
around them (police, hospitals/clinics, pharmacies, shops, public transport, establishment
density, explicit OSM access tags). It runs as a separate Python/FastAPI service that the Express
backend calls; the existing route scoring, recommendation and confidence logic is **not** changed.

> **What this is not.** Clusters are not crime predictions and not a safety rating. There are no
> safety labels anywhere in this project, so no accuracy-style metric exists. A missing mapped
> feature is not proof that the real-world feature is absent. Clusters are named for what they
> contain (e.g. *Infrastructure-rich*, *Infrastructure-sparse*), never "safe/unsafe".

## Pipeline

```
GeographicFeature (read-only) ─► extract ─► road_features.csv + RoadSegmentFeature (Mongo)
                                              │
                          evaluate (plots + report) ◄┤► train ─► models/<scope>/<version>/
                                                      │               kmeans, scaler, imputer,
                                         assign ◄─────┘               feature list, profiles, metadata
                                              │
                         FastAPI ◄── Express (`/api/safe-routes/:id/infrastructure`) ◄── React
```

**Segmentation.** Road ways (`LineString`/`MultiLineString` with a real `highway` value; highway
*nodes* such as crossings and closed building outlines are excluded) are split at junctions, i.e.
coordinates shared with another road (the importer stores no node IDs, so shared coordinates are
the junction signal), then capped at 200 m. Pieces under 20 m are kept in the data but flagged
`is_short` and excluded from training.

**Geometry.** Geometry is projected to the city's UTM zone (EPSG:32643 for all three cities) for
metre-accurate lengths and distances. Points, lines, multi-lines and polygons (areas use their
boundary distance) are all handled.

**Missing vs zero.** If a feature class has *no imported records at all* in a city, its counts and
distances are `NaN` (unknown), not `0`. If the class exists but nothing is within the radius, the
count is a genuine `0` and the real nearest distance is still computed. Segments close to the city's
bounding-box edge are flagged `near_bbox_edge` because facilities just outside the import box are
invisible. Access features come only from explicit tags (`foot`, `motor_vehicle`/`vehicle`,
`sidewalk`), never inferred from road type; features with too much missingness are dropped
automatically and listed in the model metadata.

**Model.** Log transform on heavy-tailed features → median imputation (fitted on training data) →
`StandardScaler` → K-Means. `k` is not assumed: elbow (inertia) and silhouette are computed for each candidate and the
choice is reported. City identity is never a feature; the global model trains on a per-city
balanced sample.

**Evaluation** (`evaluate`) reports city-specific models, the global model, and
leave-one-city-out generalisation, plus cluster stability (adjusted Rand index across seeds) and
the association between cluster and city (NMI) so you can see whether city is dominating.

## Setup

Python 3.11+ (developed on 3.13).

```bash
cd ml_service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt            # add requirements-dev.txt for tests
cp .env.example .env                       # then edit; never commit .env
```

`.env` (see `.env.example`): `MONGO_URI` (same database as the backend), `ML_SERVICE_API_KEY`
(shared secret). Prefer a dedicated MongoDB user with **read** on `geographicfeatures` and
**readWrite** on `roadsegmentfeatures` only. The ML code never modifies `GeographicFeature`.

## Run it (in order)

Prerequisite: `GeographicFeature` is already populated by the existing importer
(`npm run import:osm -- --city=jalandhar --fetch --fresh`, etc.).

```bash
# 1. Features: road_features.csv (data/) and the RoadSegmentFeature collection
python -m safira_ml.cli extract --city all

# 2. Evaluation: city-specific, global, leave-one-city-out, with plots (reports/)
python -m safira_ml.cli evaluate

# 3. Train and save the global model, then write assignments into RoadSegmentFeature
python -m safira_ml.cli train --scope global
#    (--k 5 to force k; --scope delhi for a city-specific model; --from-csv to skip MongoDB)

# 4. Serve the API for Express
python -m safira_ml.cli serve --port 8001
```

You can run `extract`/`evaluate`/`train` entirely offline from a CSV or a JSONL dump with
`--file` / `--from-csv`, `--no-mongo`, and `--no-assign`.

Outputs:

| Output | Location |
|---|---|
| Processed dataset (one row per road segment) | `data/road_features.csv` |
| Mongo collection | `roadsegmentfeatures` (`RoadSegmentFeature`) |
| Model artifacts (per scope and version) | `models/<scope>/<version>/` : `kmeans.joblib`, `scaler.joblib`, `imputer.joblib`, `model.json`; `models/<scope>/latest.json` points at the active version |
| Evaluation | `reports/evaluation_report.md` / `.json` |
| Plots | `reports/k_selection_*.png` (elbow + silhouette), `pca_*.png`, `profiles_*.png`, `cluster_city_composition.png` |

`model.json` holds the feature list, per-cluster profiles (median, IQR, missing share), the
model version, library versions and training metadata (data versions, parameters, metrics). New
segments are always assigned with the **saved** scaler/imputer/K-Means; nothing is retrained per
request. Model files are loaded with joblib (pickle): only load models from a directory you control.

## API (called by Express, not by browsers)

All endpoints except `/health` need the header `X-API-Key: $ML_SERVICE_API_KEY`; if the variable
is unset they refuse to serve (fail closed).

| Method & path | Purpose |
|---|---|
| `GET /health` | liveness and active global model version |
| `GET /v1/features/info` | feature definitions, road groups, disclaimer |
| `POST /v1/features/generate` | `{cityId}` run extraction (CSV and/or Mongo) |
| `POST /v1/model/train` | `{scope, k?}` train, save and assign |
| `GET /v1/model`, `GET /v1/model/profiles` | model metadata / public cluster profiles |
| `POST /v1/segments/assign` | assign clusters to supplied segment features with the saved model |
| `POST /v1/routes/profile` | `{cityId, routes:[{id, coordinates:[[lon,lat],…]}]}` share of each route in each cluster |

Interactive docs at `http://127.0.0.1:8001/docs` when running locally.
Generate/train jobs are serialised (a second concurrent job gets HTTP 409).

## Density map (PNG)

```bash
python -m safira_ml.cli density-map --from-csv data/road_features.csv   # after `train`
```

Writes `reports/infrastructure_density_map.png`: every road segment coloured by its cluster's
level (one sequential hue, darker = more *mapped* infrastructure) per city, plus the share of
segments per level. It uses the saved model and is **descriptive only**: it is not a safety map,
sparse mapping looks the same as sparse infrastructure, and it does not feed route scores.

## Algorithm comparison

K-Means was chosen as the starting point, then benchmarked against nine alternatives (MiniBatch and
Bisecting K-Means, two Gaussian Mixtures, Birch, Ward, Spectral, DBSCAN, HDBSCAN) with identical
preprocessing and written-down rules (must score new segments from a saved model, must profile every
segment, must be reproducible, then quality/transfer/city-dependence, simplest wins ties).

```bash
python -m safira_ml.cli compare            # writes reports/algorithm_comparison.{md,json,png}
```

Plain-language explanation for presentations: [`ALGORITHM_CHOICE.md`](ALGORITHM_CHOICE.md).

## Express and UI integration

Set in `backend/.env`:

```env
ML_SERVICE_URL=http://127.0.0.1:8001
ML_SERVICE_API_KEY=<same value as ml_service/.env>
# optional: ML_SERVICE_TIMEOUT_MS=15000   ML_MODEL_SCOPE=global
```

If these are unset, the Safe Route page behaves exactly as before and simply shows no profile.
Added routes (JWT required): `GET /api/safe-routes/:id/infrastructure`, `GET /api/infrastructure/model`.
The React route cards show the infrastructure profile next to the existing indicators. It does not
affect score, confidence or ranking. Using clusters in scoring would be a separate, versioned
change that needs its own evaluation.

## Supervised dataset builder (P3)

Builds the labelled table a future incident-probability model would learn from. **It trains nothing**, does not
touch K-Means, route scores or the database, and never invents an incident.

```bash
python -m safira_ml.cli inspect-incidents          # what incident data exists / what is missing
python -m safira_ml.cli build-dataset              # road_features.csv + data/incidents/ -> data/datasets/dataset_<id>/
#   --radius 100  --match-mode radius|nearest  --features PATH  --dir PATH  --out PATH
#   --backend-export export.jsonl | --mongo-collection NAME  [--field-map map.json]   (backend incident reports)
```

Exit code 0 = trainable, 3 = built but **not** trainable (the normal state until real data exists), 2 = error.
With zero incidents it writes only the manifest/report and says that no real training dataset is available.

**Inputs.** `data/road_features.csv` (from `extract`, reused as-is); incident records (`data/incidents/*.csv|jsonl`
or backend reports through the adapter in `risk/adapters.py`); `data/incidents/coverage.json`. Incident data is
private and git-ignored. Cities come from the registry, so Jalandhar, Bathinda, Delhi and any city in `cities.json`
work without code changes.

**Row** = road segment x local calendar month x time band (`night` 22-05, `early` 05-09, `day` 09-17, `evening` 17-22,
city-local time). Rules, in short (full text in `safira_ml/risk/labels.py`):

| Outcome | Rule |
|---|---|
| `label = 1` | a **verified**, in-scope, de-duplicated incident with a known time of day and location error <= radius lies within the radius of the segment geometry in that month and band |
| `label = 0` | only inside a **usable complete coverage window** (explicit `complete: true`, geocoding <= radius, covers the whole month, optional `bbox` contains the segment, and the window's source actually delivered records for that city/period) and nothing below applies |
| unlabelled | everything else: no complete coverage; a **pending** incident, a date-only incident, or an incident with unknown/oversized location error could affect the row; or a positive lies in the guard band (radius, radius + its error] |
| ignored | **rejected** incidents (no effect), duplicates, out-of-scope categories. **SOS alarms are never incidents** (`sos` is not an accepted source and the SOS/activity collections are never read) |

Positives outside complete coverage are kept (`label = 1`) but marked `training_eligible = False`, so a model cannot
learn "where data exists" as risk. `--match-mode nearest` labels only the nearest segment per incident.
Infrastructure features are carried through untouched (missing stays missing) and **never influence a label**.

**Outputs** in `data/datasets/dataset_<id>/` (the id is a hash of all inputs: same inputs, same bytes; new verified
reports are picked up by running the command again): `observations.csv`, `incident_decisions.csv` (every incident, its
decision and reason, duplicate link, provenance such as `verified_by/at`, `source_file`), `incident_matches.csv`
(every incident x segment match with distance and effect), `segment_exclusions.csv`, `manifest.json` (input sha256,
parameters, coverage audit, counts, blockers) and `BUILD_REPORT.md`.
Size grows with segments x 4 x covered months (100k segments x 12 months = 4.8M rows, ~1.3 GB CSV, ~90 s).

Incident records containing an id/ref that starts with `SYNTHETIC` are flagged: the dataset is marked synthetic, can
never be trainable, is written to `latest_synthetic.json`, and cannot be mixed with real records. Test fixtures live
only in `tests/`.

## Tests

```bash
pip install -r requirements-dev.txt && python -m pytest -q
```

The tests use **synthetic fixtures that exist only inside the test suite**; they are never written
to MongoDB, the CSV, or a model directory. A test also fails if the city bounding boxes drift from
`backend/src/config/safeRouteConfig.js`.

## Limitations

- Only mapped OSM data is visible. Sparse mapping and sparse infrastructure look the same to the model.
- Straight-line proximity, not road-network travel distance.
- OSM opening hours, lighting and surveillance are not modelled here (`lit` is recorded as informational only).
- Cluster quality depends on the data you import; read `reports/evaluation_report.md` before relying on any cluster naming.
