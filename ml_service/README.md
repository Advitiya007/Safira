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
