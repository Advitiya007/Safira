# SafeHer India (Safira) — Technical Architecture & Project Reference

## 1. System Overview

**SafeHer India (Safira)** is a full-stack, women-first safety and route recommendation platform designed for women traveling alone in India. It empowers travelers by analyzing road infrastructure, proximity to emergency facilities (police, hospitals, pharmacies), public transit, active commercial establishments, street lighting, and mapped surveillance.

> **Core Principle**: Never claim any route is guaranteed safe. Routes are evaluated against mapped OpenStreetMap indicators and reported data confidence. Missing data must never be interpreted as safety.

---

## 2. Technology Stack & Infrastructure

- **Frontend**:
  - React 19, Vite 8, Tailwind CSS 4
  - React Router 7, Leaflet 1.9 & React-Leaflet 5
  - Lucide React icons
  - Context API (`SafetyTrackingContext`, `ThemeContext`)
- **Backend**:
  - Node.js (v22 / ESM modules), Express.js 4
  - MongoDB Atlas with Mongoose 7 (2dsphere geospatial indexing)
  - Valhalla routing engine (`valhalla1.openstreetmap.de` or self-hosted)
  - Overpass API with exponential retry backoff & raw snapshot caching
  - JWT Authentication, Bcrypt password hashing
  - AES-256-GCM contact encryption for user and guardian phone numbers
- **Machine Learning (Infrastructure Profiling)**:
  - Python 3.13
  - NumPy, Pandas, Scikit-learn, SciPy, Matplotlib
  - Shapely, GeoPandas

---

## 3. Database Architecture & Models

### 3.1 Existing Models (`backend/src/models/`)

1. **`City`**:
   - `cityId` (String, unique): currently constrained to `['jalandhar', 'bathinda', 'delhi']`.
   - `name`, `state`, `country`, `timezone`.
   - `boundary` (GeoJSON Polygon/MultiPolygon with 2dsphere index).
   - `boundaryMetadata`: source type, verification status (`verified`, `prototype`), source URL, license.
   - `featureImportStatus`: `pending`, `importing`, `imported`, `failed`.
   - `featureCount`: Total count of imported features.
   - `coverage`: Breakdown for `roads`, `activity`, `lighting`, `surveillance`, `emergency`, `publicTransport`.

2. **`GeographicFeature`**:
   - `cityId` (String, indexed).
   - `osmType` (`node`, `way`, `relation`), `osmId` (String).
   - Compound unique index: `{ cityId: 1, osmType: 1, osmId: 1 }`.
   - `geometry` (GeoJSON with 2dsphere index).
   - `tags` (Mixed OSM key-value pairs).
   - `featureCategories` (Array of Strings: `roads`, `activity`, `lighting`, `surveillance`, `emergency`, `publicTransport`).
   - `source`, `sourceTimestamp`, `importedAt`, `dataVersion`, `importRunId`.

3. **`GeographicImportRun`**:
   - City-level import tracking with single active run mutex `{ cityId: 1, status: 'running' }`.
   - Tracks counts for elements fetched, normalized, upserted, and errors.
   - Preserves raw Overpass cache on disk for idempotent resume operations.

4. **`RouteAnalysis`**:
   - `userId`, `cityId`, `mode` (`walking`, `driving`), `departureTime`.
   - `origin`, `destination` (GeoJSON Points).
   - `routes`: Array of alternative paths with distance, duration, score, data confidence, indicator breakdown, emergency facilities, segment details.
   - `recommendationStatus`: `recommended` | `insufficient_data`.
   - `minimumRecommendationConfidence`: Configured at 35%.
   - `algorithmVersion`: Currently version 2.
   - `expiresAt`: TTL index set to 24 hours.

5. **`User`**:
   - `fullName`, `email`, `phone` (AES-256-GCM encrypted), `password` (bcrypt).
   - `emergencyContactName`, `emergencyContactPhone` (AES-256-GCM encrypted).
   - `termsAcceptedAt`, `isActive`, `lastLogin`.

6. **`Guardian`**:
   - `userId`, `guardianName`, `guardianPhone` (AES-256-GCM encrypted).
   - `guardianPhoneHash` (HMAC lookup hash for duplicate checks without exposing plaintext).
   - `relationship`, `status` (`active`, `inactive`), `isVerified`.

7. **`SOS`**:
   - `userId`, `latitude`, `longitude`, `status` (`triggered`, `resolved`), `guardiansNotified`, `notes`.

8. **`Activity`**:
   - Security and audit log of user logins, SOS triggers, and profile actions.

---

## 4. Routing Engine & Safety Scoring Algorithm

### 4.1 Route Generation & Segmentation
- Route alternatives are fetched from Valhalla (`pedestrian` for walking, `auto` for driving).
- Routes are segmented into discrete intervals:
  - **Walking**: 150-meter segments, 125-meter feature search radius.
  - **Driving**: 200-meter segments, 200-meter feature search radius.
- Arrival time at each segment is estimated based on walking/driving duration.

### 4.2 Scoring Indicators
Each segment evaluates 7 distinct mapped indicators:
1. **`nightActivity`** (Weight: 25% walk, 15% drive):
   - Mapped shops, cafes, restaurants, pharmacies, fuel stations.
   - Evaluated against OSM `opening_hours` at estimated arrival time in the city's timezone.
2. **`lighting`** (Weight: 20% walk, 15% drive):
   - Presence of `highway=street_lamp` and `lit=yes|limited|no` on road ways.
3. **`roadAccessibility`** (Weight: 10% walk, 20% drive):
   - Evaluates pedestrian paths/sidewalks vs high-speed/unclassified roads.
4. **`cctv`** (Weight: 10% walk, 10% drive):
   - Distance to nearest mapped `man_made=surveillance`.
5. **`emergencyAccess`** (Weight: 15% walk, 15% drive):
   - Straight-line distance to nearest mapped police, hospital, clinic, or pharmacy within 1000m.
6. **`publicTransport`** (Weight: 5% walk, 10% drive):
   - Proximity to mapped bus stops, train stations, metro halts.
7. **`isolation`** (Weight: 15% walk, 15% drive):
   - Continuous stretches without any mapped active commercial establishment.

### 4.3 Data Confidence & Recommendation Logic
- **Confidence Formula**:
  $$\text{Confidence} = 100 \times \text{coverageRatio} \times (0.7 + 0.3 \times \text{hoursReliability}) \times \text{freshnessFactor} \times \text{truncationPenalty}$$
- **Recommendation Threshold**: Minimum confidence threshold is **35%**.
- If no route reaches 35% confidence, `recommendationStatus` is marked `insufficient_data`, preventing false safety recommendations.
