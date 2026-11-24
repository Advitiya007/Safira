# ML_PREDICTION_PROGRESS.md - supervised incident-probability model

**Read this first in every new session**, then run `git status` and continue from the first
unchecked task in section 4. Companion notes: `project.md` (K-Means work, owner rules).

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
- [ ] P2 Incident ingestion: schema, validation, coverage manifest, dedupe, `inspect-incidents` CLI (reports what exists / what is missing)
- [ ] P3 Dataset builder: reuse `road_features.csv`, optional municipal CSV features (streetlights, CCTV), time windows, labels with coverage rule, trainability gate
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

