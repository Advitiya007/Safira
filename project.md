# project.md — Safira / SafeHer India working notes

Living notes for Claude (and humans). **Read this file first at the start of every session** (the owner asked for this),
then continue from section 0. After implementing anything, add a Learning-log entry and update section 0 (status + NEXT STEP).
Append new learnings under "Learning log" instead of rewriting history.

## 0. STATUS and NEXT STEP  (keep this section current)

Working copy: `/home/claude/safira_src/repo` (clone of github.com/Advitiya007/Safira; `/home/claude/Safira` is a pristine duplicate).
Python venv with all deps: `/home/claude/mlenv/bin/python`. Run ML tests: `cd ml_service && /home/claude/mlenv/bin/python -m pytest -q`.

| Step | State |
|---|---|
| 1. Inspect repo, plan (this file, sections 1-4) | DONE |
| 2. `ml_service/` Python pipeline: segmentation, features, CSV + `RoadSegmentFeature`, K-Means, evaluation, persistence, CLI | DONE - 32 pytest tests pass (synthetic fixtures only) |
| 3. FastAPI service (`ml_service/safira_ml/service/app.py`) | DONE (API-key protected, tested with TestClient) |
| 4. Express integration (read-only, additive) | DONE - 73/73 backend tests; verified against the REAL FastAPI app over HTTP (synthetic data) |
| 5. Frontend display next to indicators | DONE - build ok, only the pre-existing Map.jsx lint error remains |
| 6. Docs: `ml_service/README.md`, backend README, root README | DONE |
| 7. REAL run on owner's data: `extract` -> `evaluate` -> `train` | NOT DONE - needs the owner's MongoDB (sandbox has none, cannot reach Overpass) |

NEXT STEP (owner action, needs the real MongoDB): follow `ml_service/README.md` "Run it" -> `extract --city all`, `evaluate`,
READ `reports/evaluation_report.md` (is k sensible? does city dominate? are cluster names honest?), then `train --scope global`, `serve`,
set `ML_SERVICE_URL`/`ML_SERVICE_API_KEY` in backend/.env, and eyeball a real route in the UI.
Then (Claude): review real evaluation results, tune `ExtractionParams`/feature coverage if features are dropped, commit/push (not done yet: nothing is committed).
Any use of clusters in route scoring = separate, versioned, separately evaluated change (bump ROUTE_SCORING_VERSION; do NOT do it silently).

## 1. Repository map (verified by reading the code)

```
backend/   Node 18+ ESM, Express 4, Mongoose 7, `node --test` (62 tests pass at baseline)
frontend/  React + Vite, Tailwind-style tokens, lucide-react, Leaflet map
ml_service/  (NEW) Python 3.11+ FastAPI + scikit-learn K-Means infrastructure clustering
```

Backend entry: `backend/src/server.js` (mounts `/api/...`; safe-route router is mounted at `/api`).

### Existing safe-route pipeline (DO NOT change behaviour)
- `controllers/safeRouteController.js` -> `services/safeRouteService.js#analyzeSafeRoutes`
  1. Valhalla alternatives (`routeEngineService`)
  2. `routeSegmentationService#segmentRoute` (150 m walking / 200 m driving)
  3. `geographicDataService#findFeaturesNearSegments` ($geoIntersects corridor on `GeographicFeature`)
  4. `routeScoringService#scoreRouteSegments` (weights in `config/safeRouteConfig.js`, `ROUTE_SCORING_VERSION = 2`)
  5. `routeRecommendationService#recommendRoute` (min confidence 35)
  6. Persist `RouteAnalysis` (24 h TTL) and return `analysisId` + routes.
- `RouteAnalysis.routes[].geometry` is GeoJSON `[lon, lat]`; API/UI route `coordinates` are `[lat, lon]`.
  `getSafeRouteAnalysis(id, userId)` returns stored routes with `[lat, lon]` coordinates and enforces ownership.
- Auth: `verifyToken` puts `{userId, email}` on `req.user`.

### GeographicFeature (actual, not as described in the brief)
Fields: cityId (`jalandhar|bathinda|delhi`), osmType, osmId, geometry (GeoJSON, 2dsphere), tags (raw OSM tags),
featureCategories, source, sourceTimestamp, importedAt, dataVersion, importRunId. Unique on (cityId, osmType, osmId).

**featureCategories values really are:** `roads`, `activity`, `emergency`, `publicTransport`, `lighting`, `surveillance`.
There are NO `police`, `hospital`, `pharmacy`, `shops` categories. Those classes must be derived from `tags`
(`amenity=police|hospital|clinic|pharmacy`, `shop=*`, ...), the same way `routeScoringService.js` does it.
- `roads` = any element with a `highway` tag except `street_lamp` and `bus_stop`. That INCLUDES highway NODES
  (crossings, traffic signals, ...). Road segmentation must keep only LineString/MultiLineString geometries with a real road `highway` value.
- Geometry types actually written by the importer: `Point` (nodes, relation centroids), `LineString` (ways — also CLOSED ways
  such as shop/hospital building outlines, which are areas not lines), `MultiLineString` (relations). It never writes `Polygon`.
  The ML code still handles Point/LineString/MultiLineString/Polygon/MultiPolygon and treats closed rings with area-like tags as areas.
- Importer bbox is the coverage region (`CITY_BOUNDING_BOXES` in `config/safeRouteConfig.js`), not a municipal boundary.
  All three cities fall in UTM zone 43N (EPSG:32643).
- Ways are imported with full node geometry only (no node IDs). Road intersections therefore have to be found by
  exact shared-coordinate matches (Overpass returns 7-decimal lon/lat, so shared OSM nodes match exactly).

### Reusable existing definitions (mirror them, do not redefine differently)
- Establishment = `shop` (not `no`) or amenity in restaurant, cafe, fast_food, pub, bar, food_court, marketplace, pharmacy, fuel.
- Emergency = amenity police, hospital, clinic, pharmacy; search radius 1000 m (`EMERGENCY_FACILITY_SEARCH_RADIUS_METERS`).
- Public transport = `highway=bus_stop`, `public_transport=*`, `railway` station/halt/tram_stop, `amenity=bus_station`.
- Frontend map page: `frontend/src/pages/Map.jsx`; route cards in `components/Map/SafeRoutePanel.jsx` (`SafeRouteAlternatives`);
  HTTP via `frontend/src/utils/api.js#safeRouteAPI`.

## 2. Hard rules from the owner
- ML clustering is unsupervised and describes MAPPED infrastructure only. Never call clusters safe/unsafe, never claim crime prediction.
- Absence of a mapped feature is not evidence of absence in the real world (also stated in backend README).
- Do not modify/delete `GeographicFeature`. Do not change route scoring, recommendation, confidence, `RouteAnalysis` schema or ranking.
- Do not fabricate geographic records or labels. Preserve missing (NaN/null) separately from genuine zero.
- Any future scoring use of clusters must be separately evaluated and versioned.

## 3. Environment limits seen so far
- Sandbox cannot reach Overpass and has no MongoDB, so the pipeline was validated on SYNTHETIC fixtures (tests only, never stored).
  Real `road_features.csv`, the real trained model and real evaluation/plots must be produced by running the CLI against the real DB.
- Python deps: geopandas, shapely, pyproj, pymongo, fastapi, scikit-learn, pandas, numpy, matplotlib, joblib, httpx (tests).

## 4. Design decisions (ML)
- Collection: Mongoose model `RoadSegmentFeature` -> MongoDB collection `roadsegmentfeatures` (Mongoose pluralisation). Python writes the same collection.
- Segmentation: split road ways at junction vertices (coordinates shared by >1 way or way endpoints), then cap piece length (default 200 m)
  into equal parts. Pieces < 20 m kept in dataset but flagged `isShort` and excluded from training.
- Missing vs zero: a feature class with NO imported records in a city gives NaN counts/distances (unknown), never 0.
  If the class exists in the city, "none within radius" is a genuine 0 and the real nearest distance is still computed.
  Segments near the bbox edge are flagged (`nearBboxEdge`) because facilities just outside the import box are invisible.
- Accessibility features come only from explicit tags (`foot`, `motor_vehicle`/`vehicle`, `sidewalk`); no inference from highway type.
  Features with too much missingness are dropped from the model automatically and listed in metadata.
- City identity is never a feature. Global model trains on a per-city balanced sample. City-specific, leave-one-city-out and
  cluster-vs-city association (NMI) are reported separately.
- Models are saved per scope/version: kmeans, scaler, imputer, feature list, transform spec, profiles, training metadata (joblib + JSON).
- Express integration is read-only and additive: `GET /api/safe-routes/:id/infrastructure` + `GET /api/infrastructure/model`.
  Existing analyze response, ranking and persisted `RouteAnalysis` are untouched. UI shows the profile next to indicators.

## 5. Learning log
- 2026-11-23: Cloned repo (public). Baseline `npm test` in backend: 62/62 pass. Frontend `npm install` ok.
- 2026-11-23: Discovered brief's category list does not match stored `featureCategories` (see section 1).
- 2026-11-23 (session restart): Found `ml_service/` already built in this working copy (never logged here). Re-verified: `pytest` 32 passed.
  `backend/` and `frontend/` still unmodified (git status shows only `ml_service/` + `project.md` untracked). FastAPI contract that Express must call:
  `GET /health` (no key); with header `X-API-Key`: `GET /v1/model/profiles`, `POST /v1/routes/profile` body `{cityId, scope, routes:[{id, coordinates:[[lon,lat]...]}]}`
  -> `{modelVersion, scope, cityId, routes:[{routeId, routeLengthMeters, assignedCoveragePercent, unmatchedLengthMeters, dominantCluster, clusterShares[], matching}], disclaimer}`.
  Mongo `roadsegmentfeatures` docs: `{cityId, segmentKey, roadType, roadGroup, geometry, midpoint, features{}, informational, flags, extraction{}, modelAssignment|null}`.
  NEXT STEP: Express layer (`mlServiceConfig.js`, `RoadSegmentFeature` model, `infrastructureService.js`, 2 GET routes) + node tests with injected fetch.
- 2026-11-23: Express integration DONE (backend: 73/73 tests pass = 62 baseline + 11 new). Files CREATED: `backend/src/config/mlServiceConfig.js`
  (env: ML_SERVICE_URL, ML_SERVICE_API_KEY, optional ML_SERVICE_TIMEOUT_MS, ML_MODEL_SCOPE; disabled unless URL+key set), `backend/src/models/RoadSegmentFeature.js`
  (read-only mirror of the Python collection, autoIndex:false because Python owns indexes), `backend/src/services/infrastructureService.js`
  (factory with injectable fetch; fails soft -> `{available:false, reason}`; converts [lat,lon]->[lon,lat]; 5-min profile cache), `backend/src/controllers/infrastructureController.js`,
  `backend/test/infrastructureService.test.js`. MODIFIED (additive only): `backend/src/routes/safeRouteRoutes.js` (+2 GET routes, JWT required):
  `GET /api/safe-routes/:id/infrastructure` and `GET /api/infrastructure/model`. `analyzeSafeRoutes`, scoring, recommendation, RouteAnalysis untouched.
  Response of /infrastructure: `{available, modelVersion, scope, cityId, routes:[{routeId, assignedCoveragePercent, unmatchedLengthMeters, dominantCluster, clusterShares[]}], clusters:{id:{name,level,description,share}}, disclaimer}`.
  NEXT STEP: frontend - `safeRouteAPI.getInfrastructure`, new `components/Map/InfrastructureProfile.jsx`, render inside route cards in `SafeRouteAlternatives`, fetch in `pages/Map.jsx` after analysis (non-blocking, never touches ranking).
- 2026-11-23: Frontend DONE (lint: only the PRE-EXISTING `setSearchQuery` unused error in Map.jsx remains - not ours, left alone; `vite build` ok; SSR smoke test of all states ok).
  CREATED `frontend/src/components/Map/InfrastructureProfile.jsx` (+ `InfrastructureProfileNote`). MODIFIED (additive): `frontend/src/utils/api.js` (`safeRouteAPI.getInfrastructure/getInfrastructureModel`),
  `components/Map/SafeRoutePanel.jsx` (new optional `infrastructure` prop; renders under the indicator list), `pages/Map.jsx` (effect keyed on `routeMetadata.analysisId`, non-blocking, derived loading state).
  UI rules: one neutral hue (no red/green), text percentages next to the bar, nothing rendered when ML is `not_configured`, short muted note otherwise; ranking/score UI untouched.
  NEXT STEP: docs (`ml_service/README.md`, backend README env + endpoints, root README roadmap/structure), `ml_service/.gitignore`, optional render.yaml service entry; then final full verification.
- 2026-11-23: Docs + verification DONE. Created `ml_service/README.md`, `ml_service/.gitignore` (ignores data CSV, models/*/, plots, caches, .env); extended `backend/README.md` and root `README.md`.
  Final checks: ml_service pytest 32 passed; backend `npm test` 73 passed; frontend build ok. Cross-service contract test (scratch, not committed): real FastAPI app + real Node
  `createInfrastructureService` over HTTP on SYNTHETIC data -> shares parsed, legend merged, off-network route = 0% matched & dominantCluster null, wrong key -> `service_misconfigured`, service down -> `service_unavailable`.
  Learnings: (a) README pipeline order is log1p -> median impute -> StandardScaler. (b) mongomock lacks `$geoIntersects`; tests use `LocalStore.find_near` (shapely). (c) `/home/claude/Safira` and
  `/home/claude/safira_src/repo` are two clones; work lives in `safira_src/repo` and NOTHING IS COMMITTED (owner never asked) - deliver via tarball or ask before pushing.
  NEXT STEP: owner runs the pipeline on real data (see section 0); then review `evaluation_report.md` together.
