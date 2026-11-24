# ML_PREDICTION_PROGRESS.md - supervised incident-probability model

**Read this first in every new session**, then run `git status` and continue from the first
unchecked task in section 4. NOTE: work lives on branch `feature/ml-infrastructure-clustering` (the repo's default branch `claude--test` is older and has no ML_PREDICTION_PROGRESS.md). Companion notes: `project.md` (K-Means work, owner rules).

## 0. Goal and honesty rules

Predict, for a road segment + its surrounding infrastructure + a time window, the probability `p`
that a **recorded, verified safety incident** occurs in or near the segment in that window.
`Safety Score = (1 - p) * 100` (only ever produced by a model that passed the evaluation gate).

Non-negotiable rules (from the owner):
1. No invented labels. No synthetic data outside `tests/`. No model is trained unless real, verified,
   geolocated, time-stamped incidents exist (hard gate in code, see `labels.require_trainable`).
2. Infrastructure-rich != safe and infrastructure-poor != unsafe. The model must *learn* any
   relationship from incident labels, and we report whether infrastructure adds value over
   time-only / prevalence baselines. It is allowed to find "no value".
3. Missing incident records are NOT "no incident". A label of 0 exists only inside a declared
   **coverage window** (source x city x period with stated completeness + geocoding precision).
   Everything outside is *unlabelled* and excluded from training and evaluation.
4. Keep Jalandhar, Bathinda, Delhi and all existing data. Keep K-Means (`clustering.py`, `compare.py`,
   density map) untouched and separate. Do NOT change route scoring/recommendation/confidence until
   the model is evaluated AND the owner approves (`ROUTE_SCORING_VERSION` stays 2).
5. Reuse existing extracted features (`RoadSegmentFeature` / `data/road_features.csv`). Do not re-extract.
6. Never commit secrets or private data (incident files live outside git: `ml_service/data/incidents/` is git-ignored).

## 1. What exists today (inspected 2026-11-24)

- `ml_service/safira_ml/`: `extract.py` (road segmentation + infrastructure features per segment,
  writes `road_features.csv` and Mongo `roadsegmentfeatures`), `features.py`, `geo.py` (UTM, projection),
  `clustering.py`/`training.py`/`evaluation.py`/`compare.py`/`density_map.py` (unsupervised K-Means + 9 alternatives),
  `persistence.py` (joblib bundles), `store.py` (Mongo/local), `route_profile.py`, `service/app.py` (FastAPI, X-API-Key, fail closed).
- Segment feature columns (`RAW_FEATURE_COLUMNS`): length_m, police/hospital/pharmacy count + nearest_m, shop_count,
  transport_count, establishment_count/density, foot/vehicle access, sidewalk_present; informational `lit_tag`.
  Segment keys `segment_key`, `cityId`, `mid_lat`, `mid_lon`, `road_type`, `road_group`, `is_short`, `near_bbox_edge`.
- Cities are hard-coded in 3 places: `ml_service/safira_ml/config.py` (`SUPPORTED_CITIES`, `CITY_BOUNDING_BOXES`),
  `backend/src/config/safeRouteConfig.js` (`SUPPORTED_CITIES`, `CITY_BOUNDING_BOXES`, boundary names/reference points),
  guarded by `tests/test_config_sync.py`.
- Existing user-generated data in the app: `SOS` (userId, lat, lon, status triggered/resolved, triggeredAt, notes) and
  `Activity` (login/map_opened/sos_triggered). There is **no incident-report model**.
- Test baselines: ML 44 pass, backend 75 pass, frontend 7 pass. `xgboost 3.4.1` and `lightgbm 4.7.0` installed in `/home/claude/mlenv` (add to requirements).

## 2. Incident-data inventory (what we can actually use)

| Source | Reality (to my knowledge; not verifiable from the sandbox, which has no web access) | Usable for segment labels? |
|---|---|---|
| **In-repo data** | No incident/crime/NCRB/police/survey file exists in the repository. | No |
| **NCRB "Crime in India"** | Annual tables by state/UT and by metropolitan city; counts by crime head. No coordinates, no time of day, ~19 mega-cities only (Jalandhar/Bathinda are not among them; Delhi is). | **No** for segments. At most a city-level yearly *context/validation* number. Using it to label segments would be inventing labels. |
| **State/city police** | FIR/incident data is not published as bulk geocoded open data for Punjab; Delhi Police publishes limited FIR stats; row-level data typically needs an RTI request or an MoU, and usually has only police-station-level location. | Only if you obtain row-level records with lat/lon (or an address we can geocode with a stated error) + date/time. |
| **Municipal datasets** (streetlights, CCTV) | Not incident data. They are **features**, if you obtain them (municipal corporation / Smart City portals). | Features only |
| **OpenStreetMap** | Features only (already used). | Features only |
| **Verified field surveys** | Do not exist yet. Could give ground truth on *conditions* (lighting working, etc.), not incidents. | Features/validation only unless survey records dated incidents |
| **Verified user reports** | No report model exists. `SOS` events are alarms, not verified incidents (no category, no verification state, may be tests/false alarms). | **Not yet.** A new `IncidentReport` flow with a moderator-verification status would be needed. |

**Conclusion: today there are zero usable labelled incidents.** The pipeline can be built and tested, but no
prediction model can honestly be trained until you provide row-level, verified, geolocated, time-stamped incident
records with a coverage declaration (see section 3.3 for the exact file format).

## 3. Design

### 3.1 Label definition (the only one we use)
`y = 1` if >= 1 **verified** incident of an in-scope category lies within `R` metres of the segment (default 100 m, configurable)
during window `W`. `y = 0` only if the (segment, window) lies inside a coverage window of a source whose geocoding
precision <= `R`. Else the row is unlabelled and dropped. Interpretation: "a *recorded* incident", which carries
reporting bias (under-reporting, police-station proximity, population exposure). This bias is documented in the model card.

### 3.2 Rows and windows
Row = segment x calendar period (default month) x time band (default night 22-05, early 05-09, day 09-17, evening 17-22).
Time features: band, weekend flag, month; no per-segment ID features. Negative down-sampling (optional) is recorded and
corrected by a prior-shift formula so calibration remains meaningful.

### 3.3 Incident file contract (`ml_service/data/incidents/*.csv|jsonl`, git-ignored)
`incident_id, source, source_ref, category, occurred_at (ISO8601, tz), lat, lon, location_error_m, verification (verified|unverified|rejected)`
plus `ml_service/data/incidents/coverage.json`: list of `{source, city_id, start, end, complete: true|false, location_error_m, notes}`.
Only `verified` rows with `location_error_m <= R` inside a `complete` coverage window can create labels.

### 3.4 Models and evaluation
Logistic Regression, Random Forest, XGBoost, LightGBM on the same feature matrix (+ missing-indicator columns for models that
cannot take NaN). Baselines: prevalence; time-only model; length+time model. Probability calibration (isotonic or sigmoid) fitted on
a separate calibration split. Metrics: precision, recall, F1 (threshold chosen on validation, never on test), PR-AUC (vs prevalence),
ROC-AUC, Brier, ECE, reliability curve, bootstrap CIs. Splits: (a) leave-one-city-out, (b) spatial block CV with buffer,
(c) temporal hold-out. Gate to publish a model: beats baselines on PR-AUC with CI excluding 0, ECE below limit, LOCO result reported.

### 3.5 Dynamic cities
City registry loads built-ins + optional `cities.json` (path from `SAFIRA_CITIES_FILE`, default `ml_service/cities.json`):
`id, name, state, bbox{south,west,north,east}, timezone`. UTM zone derived from the centroid. Built-ins stay as they are.
Backend gets an equivalent additive loader (separate phase; its own tests).

## 4. Phases and tasks (check off as done; update after each)

- [x] P0 Inspect repo, inventory incident data, write this plan
- [x] P1 Dynamic city registry (ML side) + tests; keep `test_config_sync` green for built-ins
- [x] P2 Incident ingestion: schema, validation, coverage manifest, dedupe, `inspect-incidents` CLI (reports what exists / what is missing)
- [x] P3 Dataset builder: reuse `road_features.csv`, time windows, labels with coverage rule, trainability gate (optional municipal CSV features NOT done: see P3 open issues)
- [ ] P4 Supervised training: LR, RF, XGB, LGBM, calibration, baselines, splits (LOCO, spatial, temporal), metrics, report, model card, persistence
- [ ] P5 FastAPI: `/v1/risk/model`, `/v1/risk/predict` (fail-soft `available:false` until a passing model exists); safety score `(1-p)*100`
- [ ] P6 Backend: additive dynamic-city loader (JS) + tests; (route scoring untouched)
- [ ] P7 Docs (`ml_service/README.md`, data guide), requirements, final verification
- [ ] P8 (blocked on real data) Train on real incidents, read the report, decide with the owner whether to wire into route scoring

## 5. Log (newest last)

- 2026-11-24 P0 done: inspection + inventory + plan (this file). No code changed yet.
- 2026-11-24 P1 done. CREATED `ml_service/safira_ml/cities.py` (parse/validate/load; fails loudly on bad file), `ml_service/cities.example.json`, `ml_service/tests/test_cities.py` (12 tests).
  MODIFIED `safira_ml/config.py` (BUILTIN_CITIES / BUILTIN_CITY_BOUNDING_BOXES kept exactly; `SUPPORTED_CITIES`, `CITY_BOUNDING_BOXES`, new `CITY_META`, `EXTRA_CITIES` now include cities from `SAFIRA_CITIES_FILE` or `ml_service/cities.json`),
  `tests/test_config_sync.py` (compares built-ins to the Node config), `.gitignore` (cities.json, data/incidents/, data/municipal/).
  Tests: ML 55 pass (44 + 11 net new; all existing green). CLI `--city` choices and API validators pick up new cities automatically.
  NOTE: the Node backend still only knows the 3 built-in cities (P6) so a new city also needs P6 + an OSM import before `extract` has data.
- 2026-11-24 P2 done. CREATED `ml_service/safira_ml/risk/{__init__,config,incidents,coverage,inspect}.py`, `tests/test_risk_incidents.py` (19 tests). MODIFIED `safira_ml/cli.py` (+`inspect-incidents`; exit code 3 when not trainable).
  Rules implemented: rows are only dropped with a counted reason, never repaired; unmapped categories rejected (category_map.json maps source labels); city assigned from bbox and must agree with any declared city_id;
  naive timestamps use `naive_timestamps_timezone` and are counted; date-only rows are kept but unusable for band labels; coverage windows need explicit boolean `complete`.
  Real-state result: `python -m safira_ml.cli inspect-incidents` -> TRAINABLE: NO (no incident dir, no usable incidents, no coverage window). This is the true state of the project.
  NEXT: P3 dataset builder (labels with coverage rule, time windows, reuse road_features.csv, optional municipal features).
- 2026-11-24 P3 done (dataset builder; no model trained). Branch `feature/ml-infrastructure-clustering`.
  **Files.** CREATED `ml_service/safira_ml/risk/adapters.py` (incident-source adapters), `matching.py` (projection, STRtree matching, time bands/months, duplicates), `labels.py` (incident classes, label rules, coverage audit, `require_trainable`), `dataset.py` (orchestration, audit outputs, manifest, report), `ml_service/tests/test_risk_dataset.py` (41 tests).
  MODIFIED (additive only): `risk/config.py` (+`match_mode`, `dedupe_distance_m`, `dedupe_window_minutes`, `exclude_short_segments`, `max_horizon_months`, `SOURCE_PRIORITY`, `MATCH_MODES`), `risk/incidents.py` (pass-through provenance columns `submitted_at, verified_by, verified_at, rejected_by, rejected_at` + `source_file`; free-text description is deliberately NOT carried), `risk/coverage.py` (optional `bbox` on a window; absent = whole city), `cli.py` (+`build-dataset`), `.gitignore` (+`data/datasets/`), `ml_service/README.md` (P3 section). Not touched: K-Means code, route scoring, backend, frontend, any data.
  **Command.** `python -m safira_ml.cli build-dataset [--features --dir --out --radius 100 --match-mode radius|nearest --backend-export F.jsonl | --mongo-collection NAME --field-map M.json]`; exit 0 trainable / 3 built but not trainable / 2 error.
  **Outputs** (`data/datasets/dataset_<12-hex id of all inputs>/`, git-ignored): `observations.csv`, `incident_decisions.csv`, `incident_matches.csv`, `segment_exclusions.csv`, `manifest.json`, `BUILD_REPORT.md`; plus `data/datasets/latest.json` (or `latest_synthetic.json`).
  **Dataset schema (`observations.csv`).** `observation_id` (`city|segment|period|band`), `city_id`, `segment_key`, `period` (YYYY-MM, city-local), `time_band` (night/early/day/evening), `label` (0/1), `label_reason`, `training_eligible`, `training_exclusion_reason`, `coverage_status` (complete|none), `coverage_window_ids`, `incident_count` (de-duplicated events), `incident_ids`, `incident_sources`, `nearest_incident_distance_m`, `match_radius_m`, `match_mode`, `data_origin` (real|synthetic), then carried unchanged from `road_features.csv`: `length_m, police/hospital/pharmacy count + nearest_m, shop_count, transport_count, establishment_count, establishment_density_per_km2, foot_access, vehicle_access, sidewalk_present, lit_tag (informational only), road_type, road_group, is_short, near_bbox_edge, mid_lat, mid_lon, extraction_run_id`. P4 must train only on `training_eligible == True`, must not use `lit_tag`, ids, `incident_*`, `coverage_*`, `nearest_incident_distance_m` as features (they are label-derived), and must handle NaN features.
  **Label rules** (authoritative text: docstring of `risk/labels.py`). Row = segment x local month x time band. y=1: verified + in-scope category + time of day known + location error known and <= R + not a duplicate, within R (default 100 m, UTM distance to the segment geometry) in that month/band. y=0: only inside a usable complete coverage window (complete=true, window geocoding <= R, whole month inside the window, optional bbox contains the segment, AND the window's source delivered >=1 record for that city inside the window - "complete" with no data is not evidence). Pending incident, date-only incident, unknown/oversized location error => nearby rows UNLABELLED (unknown error: whole city for that month/band). Positive with error e at distance in (R, R+e] => neighbour row unlabelled (guard band). Rejected => no effect. Duplicates (same city+category, <=50 m, <=120 min; date-only only with date-only on the same date) collapse to one event (verified > source priority > id) and only affect counts. Positives outside complete coverage are written with `training_eligible=False` (avoids teaching the model coverage). Unlabelled rows are counted by reason in the manifest, never written. SOS is never read (`sos` not an accepted source; collection guard in adapters). Infrastructure features never influence labels (tested). `nearest` mode: only the nearest segment per incident is positive, the other segments within R become unlabelled (use if one incident labelling several nearby segments is judged too generous; default stays `radius`, the plan's 3.1 definition).
  **Backend adapter (`BackendIncidentSource`).** Built to the described CONTRACT only (status PENDING/VERIFIED/REJECTED -> unverified/verified/rejected, verifiedBy/At, rejectedBy/At, submittedAt, nested or flat lat/lon, naive BSON datetimes treated as UTC). The real incident-report schema from the other workstream was NOT available, so field names are candidates in `DEFAULT_FIELD_MAP` and overridable with `--field-map`; a document missing a required field is rejected with a counted reason. Collection name must be given explicitly (no default); SOS/activity/users/guardians collections are refused. No new collection or schema was created.
  **Tests/results.** Whole ML suite: 115 passed (74 baseline + 41 new). New tests cover: incident->segment matching + distance, positives (+provenance, features, NaN stays NaN), negatives only in complete coverage, unusable windows (incomplete / coarse geocoding / wrong city / source delivered nothing / month partly covered / bbox), band + month + UTC->local boundaries, date-only, duplicates (same id, cross-source, thresholds, distinct events), invalid/missing coordinates and invalid segments, pending vs rejected, out-of-scope category, SOS refusal, guard band and unknown/oversized error, nearest mode, audit files, independence from infrastructure, deterministic rebuild + new report picked up, zero incidents, missing files, synthetic marker + no mixing, three built-in cities + trainability gate, city isolation, a dynamic city end-to-end through the CLI in a subprocess, CLI exit codes, backend mapping (+mongomock). Mutation check: disabling coverage, pending handling, guard band, dedupe or midnight-wrapping each made tests fail. Scale check (scratch, not committed): 100k synthetic segments x 12 months = 4.8M rows, ~90 s, ~1.1 GB RSS, 1.3 GB CSV.
  **Real state.** The sandbox has no `road_features.csv` and no incident data (both git-ignored; the owner has the CSV locally), so no real dataset exists or was built: `build-dataset` here exits 2 (CSV missing). With the real CSV and no incidents it reports "No real training dataset is available". Synthetic fixtures live only in `tests/` and every test writes under pytest `tmp_path`.
  **Open issues / owner decisions.** (1) `radius` vs `nearest` default (see above). (2) Plan 3.2 mentions a "weekend flag" but the row grain is a month, so it is not representable; adding a day-type dimension doubles the rows - decide in P4. (3) Output volume (segments x 4 x covered months); consider negative down-sampling with prior-shift correction in P4 (stream by `period`). (4) Records from the incident-report workflow will be unusable as positives unless each carries a location error <= R (e.g. GPS accuracy) and a time of day; blank error => "location uncertain". (5) Verified user reports are never "complete" coverage, so they yield positives with `training_eligible=False` unless the owner declares a defensible complete window. (6) Naive timestamps are interpreted as Asia/Kolkata (P2 rule, flagged `timezone_assumed`); month/band boundaries are not widened for it. (7) Municipal CSV features (streetlights/CCTV) not implemented: no data exists. (8) Distances are straight-line UTM, not network distance. (9) Incident `description` text is intentionally never carried into datasets.
  **EXACT NEXT TASK = P4** (only after real, verified incidents + a real `coverage.json` + the real `road_features.csv` exist; run `build-dataset` and check `manifest.json` has `trainable: true` and `isSynthetic: false`): `ml_service/safira_ml/risk/training.py` - call `labels.require_trainable(manifest)` first; read `observations.csv` filtered to `training_eligible`; baselines (prevalence, time-only, length+time), LR / RF / XGBoost / LightGBM, LOCO + spatial-block + temporal splits, calibration, metrics + CIs, model card. If the data does not exist yet, P4 must not be started with synthetic data; the next useful step is P6/P7 (dynamic-city loader in the Node backend, docs) or obtaining the data.
