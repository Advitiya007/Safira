# Safira Backend API

The Node.js/Express backend powering Safira, a women's safety and wellness platform.

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB (Local or Atlas)

### Installation
```bash
npm install
```

### Environment Variables
Create a `.env` file in this directory:
```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_key
FRONTEND_URL=http://localhost:5173
CONTACT_ENCRYPTION_KEY=optional-dedicated-base64-encoded-32-byte-key
```
If `CONTACT_ENCRYPTION_KEY` is not set, contact encryption derives a separate key
from the existing `JWT_SECRET` so deployments that have not added a new secret do
not fail to start. For production, a dedicated key is recommended. Generate it with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
Store it in the backend secret manager (not in source control) and keep a protected
backup: encrypted phone numbers cannot be recovered if this key is lost. Configure
the same key on every backend instance. If using the fallback, keep `JWT_SECRET`
stable as changing it will also prevent decrypting contact numbers.

Before deploying this version, back up MongoDB, stop backend writes, and run
`npm run encrypt:contacts` once against the existing database with `MONGO_URI` set
to migrate before deploying. Server startup also runs this idempotent migration
before accepting traffic, encrypting existing account, emergency-contact, and
trusted-contact phone fields. The migration creates keyed lookup hashes used for
duplicate checking and trusted-contact authorization. Do not restore an old
plaintext database snapshot without rerunning the migration.

Phone numbers are encrypted with AES-256-GCM in the application before persistence.
The keyed lookup hashes support equality checks without exposing the numbers. The
authenticated account's own profile and trusted-contact API responses can still
return decrypted values; trusted-contact numbers are masked in the UI until the
owner chooses to reveal them. Atlas operators with database read access see
ciphertext, not phone numbers, but backend instances holding the key can decrypt
the data. Restrict Atlas users, network access, and application secrets accordingly.

The dashboard's positive current-affairs feed uses a no-key Google News RSS query by default.
Set `POSITIVE_NEWS_RSS_URL` to use a different RSS feed. Headlines are keyword-screened and
cached in memory for 20 minutes; the filter is not editorial verification.

### Run Server
```bash
# Production mode
npm start

# Development mode (with nodemon)
npm run dev
```

---

## 🛠️ Technology Stack

- **Runtime**: [Node.js](https://nodejs.org/)
- **API Framework**: [Express.js](https://expressjs.com/)
- **Database**: [MongoDB](https://www.mongodb.com/)
- **ORM**: [Mongoose](https://mongoosejs.com/)
- **Security**: [JSON Web Tokens (JWT)](https://jwt.io/), [Bcrypt.js](https://github.com/dcodeIO/bcrypt.js)
- **Middleware**: [CORS](https://github.com/expressjs/cors), [Dotenv](https://github.com/motdotla/dotenv)
- **Real-time**: [Socket.IO](https://socket.io/) authenticated with the existing JWT.

Live tracking connections use the same `JWT_SECRET` and allowed frontend origins as
the HTTP API. A viewer can subscribe only when their signed-in account phone matches
an active, verified Guardian record for the tracking user. Guardian verification is
not currently implemented, so live viewer access remains disabled until that flow
marks trusted contacts as verified.

The tracking owner sends `tracking:start`, `tracking:location` (latitude, longitude,
and optional accuracy), and `tracking:stop`. An authorized guardian uses
`tracking:subscribe` with the owner's user ID and may leave with
`tracking:unsubscribe`. Location updates and session endings are sent as
`tracking:location` and `tracking:stopped`.

---

## 🛣️ API Routes

### 🔐 Authentication
- `POST /api/auth/signup`: Register a new user.
- `POST /api/auth/login`: Authenticate and receive JWT.

### 👥 Guardian Management
- `GET /api/guardians`: List all emergency contacts.
- `POST /api/guardians`: Add a new trusted contact.
- `DELETE /api/guardians/:id`: Remove a contact.

### Safe Route Recommendation

The route analyzer supports walking and driving in Jalandhar, Bathinda, and Delhi.
It requests alternative routes from Valhalla, divides each route into 150 m walking
or 200 m driving segments, and scores only mapped OSM indicators. OSM features are
queried from MongoDB once for the route alternatives; route requests do not call
Overpass.

The rule-based score combines time-aware mapped establishment activity, street
lighting, road accessibility, mapped surveillance, proximity to emergency
facilities, public transport, and mapped-activity gaps. The mode-specific weights
are centralized in `src/config/safeRouteConfig.js`. Opening-hours records are
evaluated at each segment's estimated arrival time in the selected city's
timezone; missing or invalid hours remain unknown. The mapped-indicator score
uses the full mode-specific weights, so unknown indicators contribute no
positive evidence and do not inflate the score through weight renormalization.
Data confidence is reported separately. A route is recommended only when its
confidence meets the configured 35% minimum; otherwise the API and UI state
that there is insufficient data to confidently recommend a route. Emergency
facility proximity uses straight-line distance to mapped police, hospital,
clinic, and pharmacy records within 1 km; it does not represent road-network
access. Scores are not predictions of crime risk and do not guarantee personal
safety.

Endpoints:

- `GET /api/cities`: supported cities, configured bounding-box coverage, and feature-import status.
- `GET /api/cities/locate?latitude=...&longitude=...`: detect a city from its configured coverage box.
- `GET /api/cities/:cityId/coverage`: imported OSM category counts and timestamps.
- `GET /api/places/nearby?cityId=...&latitude=...&longitude=...`: nearby imported features.
- `GET /api/geocode?q=...`: cached, rate-limited Nominatim address lookup.
- `POST /api/safe-routes/analyze` (JWT required): request alternatives with
  `cityId`, `origin`, `destination`, `mode`, and ISO `departureTime`; generates
  and stores an analysis.
- `GET /api/safe-routes/:id` and `GET /api/safe-routes/:id/details` (JWT required):
  retrieve only the signed-in user's saved analysis.

The older `POST /api/locations/route-safety` endpoint is retained for existing
clients, but the Safe Route UI uses the persisted-data analyzer above.

### Safe Route OSM Data Import

Route analysis reads persisted OSM features from MongoDB and never calls Overpass.
Feature data import does not require an OSM administrative boundary. The supported
coverage boxes for Jalandhar, Bathinda, and Delhi are centralized in
`src/config/safeRouteConfig.js`; they are configurable prototype extents, not claims
about official municipal limits. Endpoints and generated routes are constrained to
their selected city's configured box.

```bash
npm run import:osm -- --city=jalandhar --fetch --fresh
```

`--fetch` is an explicit update operation; normal map, nearby-place, and route
requests read MongoDB only. The first import can use `--fresh` to establish a
snapshot; incremental updates omit it and upsert matching OSM IDs. Configure
`OVERPASS_API_URL` for the primary endpoint and optionally provide comma-separated
fallbacks with `OVERPASS_API_URLS`. Transient overload responses (429, 502,
503, and 504) and network failures are retried up to four attempts with bounded
exponential backoff; `Retry-After` is honored within the configured maximum
delay. Configure `OVERPASS_MAX_ATTEMPTS` and `OVERPASS_TIMEOUT_MS` to override the
retry limit and request timeout. Permanent client errors fail immediately. It imports tagged road and mapped place
features (shops, relevant amenities, public transport, street lights, lit roads,
and mapped surveillance) into MongoDB. Data is normalized, filtered to the
configured box, and upserted by `(cityId, osmType, osmId)`. Import status, source,
feature counts by category, and last import time are reported by the city and
coverage APIs. Failed imports are recorded and surfaced without deleting the
previously imported dataset.

Every downloaded raw Overpass response is atomically cached under
`backend/data/osm-import-cache/<city>/` before feature processing. The directory
is ignored by git and should be retained on the import host to support resume:

```bash
npm run import:osm -- --city=jalandhar --resume
npm run import:osm -- --city=jalandhar --resume --run-id=<import-run-id>
```

Resume reprocesses the cached response and preserves the original import mode,
without contacting Overpass. Imports are serialized per city. The same city
feature data is reused by both map nearby-place endpoints and route analysis.
If an import process was terminated and left a running status behind, first
confirm that process is no longer active, then start a new fetch while explicitly
recovering that run:

```bash
npm run import:osm -- --city=jalandhar --fetch --fresh --recover-stale-run=<run-id>
```

This marks only the specified active run as interrupted before starting the new
import. Do not use it while the prior importer is still running.

For bulk import, use a regional OSM PBF processed into the existing newline-delimited
GeoJSON feature format; the importer applies the same configured bbox filter:

```bash
npm run import:osm -- --city=delhi --file=delhi.geojsonl --data-version=2026-11-05
```

Both flows require `MONGO_URI`. Do not run Overpass for individual route requests.
The bbox is a broad prototype coverage region; imported feature counts describe
records, not completeness. The absence of a mapped feature is not evidence that a
facility or safety indicator is absent.

#### Optional administrative-boundary import

The separate `--seed-boundaries` and `import:boundary` commands can still be used
to store verified boundary metadata and geometry. This is optional; missing
administrative boundaries do not block city feature import, availability, or
route analysis. A boundary, when present, does not replace the configured bbox
as the route-analysis coverage constraint.

To import a source directly, use `npm run import:boundary` with an explicit
manifest. For example:

```bash
npm run import:boundary -- --city=jalandhar --file=wards.geojson --manifest=wards.manifest.json
```

Required manifest fields are `cityId`, `sourceType`, `sourceName`, `sourceUrl`,
`sourceId`, `retrievedAt`, `license`, `licenseUrl`, `verificationStatus`,
`verificationNotes`, and `crs`. Verified municipal and ward sources also require
`identity` with the source's city/state field names and values. Ward manifests
must additionally include `identity.wardIdField` and `expectedFeatureCount`;
each ward ID must be unique and the provided feature count must match. Prototype
study areas require `sourceType: "prototype-study-area"`,
`verificationStatus: "prototype"`, detailed limitations, and must cover the
city reference point. They are displayed as prototypes, not municipal boundaries.
For automatic hybrid seeding, put the manifest and its named GeoJSON file in
`backend/data/boundary-sources/<cityId>/`; the manifest's `file` property must
be a filename in that same directory. The explicit `import:boundary` command
accepts a manifest from any local path.

Example verified ward manifest:

```json
{
  "cityId": "jalandhar",
  "file": "jalandhar-wards.geojson",
  "sourceType": "official-wards",
  "boundaryType": "ward-union",
  "sourceName": "Municipal Corporation Jalandhar ward boundaries",
  "sourceUrl": "https://example.gov.in/data/wards",
  "sourceId": "dataset-release-id",
  "retrievedAt": "2026-11-05T00:00:00.000Z",
  "license": "The dataset's stated license",
  "licenseUrl": "https://example.gov.in/data-license",
  "verificationStatus": "verified",
  "verificationNotes": "Ward membership and city extent verified from municipal source documentation.",
  "crs": "EPSG:4326",
  "expectedFeatureCount": 81,
  "identity": {
    "cityField": "town",
    "cityValue": "Jalandhar",
    "stateField": "state",
    "stateValue": "Punjab",
    "wardIdField": "id"
  }
}
```

The importer validates polygon topology, checks source identity and city coverage,
unions ward polygons, and persists the geometry as WGS84 GeoJSON. Input CRS must
be declared as `EPSG:4326`, `CRS84`, or `EPSG:3857`; Web Mercator is transformed
to WGS84. Other CRS values are rejected and must be reprojected before import.
MongoDB's unique `cityId` plus upserts make repeated imports idempotent. Higher
priority stored boundaries cannot be replaced by lower priority ones; replacing
a different source at the same priority requires `--replace`.

#### Boundary source investigation

- **OSM:** Delhi is verified as relation `21180767`, `admin_level=8`. The
  similarly named Jalandhar relation `1948563` and Bathinda relation `1948503`
  are district boundaries (`admin_level=5`); their city place nodes are not
  polygons.
- **geoBoundaries:** India's published classifications are ADM2 District,
  ADM3 Sub-District, ADM4 CD Block, and ADM5 village. These are not verified
  municipal boundaries. Sources: [geoBoundaries India ADM2](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/),
  [ADM3](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM3/),
  [ADM4](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM4/),
  and [ADM5](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM5/).
  geoBoundaries data is CC BY 4.0, but its administrative levels do not establish
  municipal limits.
- **Esri India wards:** the public [India Ward Boundaries service](https://livingatlas.esri.in/server1/rest/services/Wards/India_Ward_Boundaries/MapServer/0)
  contains 81 Jalandhar wards, linked to the [Municipal Corporation Jalandhar
  elected-authorities page](https://mcjalandhar.in/elected-authorities/). It has
  no Bathinda ward records. The item cites Esri India Master Terms rather than
  an open-data license; those terms restrict copying, redistribution, and reuse.
  The service has not been imported or used without permission.
- **Survey of India and Punjab municipal GIS:** no usable, openly licensed
  Jalandhar or Bathinda municipal boundary dataset was verified in the publicly
  accessible sources checked. Survey of India administrative-boundary pages
  checked returned unavailable/404 pages; Punjab's local-government portal was
  unavailable during this check. This does not establish that no non-public or
  offline official datasets exist.
- These boundary findings do not block bbox-based OSM feature import for
  Jalandhar, Bathinda, or Delhi. No administrative boundary is fabricated or
  substituted for the configured prototype coverage boxes.

Source name, URL, source ID, boundary type, retrieval date, license and URL,
verification status, notes, CRS, and feature count are stored in
`boundaryMetadata` and exposed through `GET /api/cities`; feature-import status,
counts, coverage categories, and timestamps are exposed alongside them.

Install `osmium-tool` separately, obtain the appropriate Geofabrik/regional
`.osm.pbf` extract, and process each configured box offline. Read the bounds
from `CITY_BOUNDING_BOXES`; `osmium extract --bbox` takes
`minlon,minlat,maxlon,maxlat`:

```bash
osmium extract --bbox=<west>,<south>,<east>,<north> --strategy=complete_ways -o jalandhar.osm.pbf regional.osm.pbf
osmium tags-filter jalandhar.osm.pbf nwr/shop nwr/amenity nwr/highway nwr/public_transport nwr/railway nwr/man_made=surveillance -o jalandhar-features.osm.pbf
osmium export -f geojsonseq -o jalandhar.geojsonl jalandhar-features.osm.pbf
npm run import:osm -- --city=jalandhar --file=jalandhar.geojsonl --data-version=2026-11
```

Replace the placeholders with the selected city's values from
`CITY_BOUNDING_BOXES` (the order is west, south, east, north). For Delhi's larger
box, a regional PBF extract is recommended over the public Overpass service.
Repeat the bbox extraction for any supported city. The importer
retains OSM type/ID, tags, source timestamps, geometry, and import timestamps,
and upserts in batches. The city-level OSM data timestamp is the latest edit
timestamp present in the imported extract; it is left unset if the extract has
no source timestamps.

Configure `VALHALLA_URL` to use a self-hosted Valhalla instance. When unset, the
backend uses the public `valhalla1.openstreetmap.de` endpoint for modest
prototype use; its availability and capacity are not guaranteed. The frontend
uses `VITE_API_URL` for the existing Express API. No routing API key is required.
`NOMINATIM_EMAIL` is an optional contact address included in address-search
requests to Nominatim.

Run the backend unit tests with `npm test` from the `backend` directory. Route
analysis requires imported geographic features for the selected bbox; it does not
require an administrative boundary.

### 🆘 SOS & Safety
- `POST /api/sos/trigger`: Initiate emergency protocol.
- `GET /api/locations/nearby`: Query nearby imported OSM features from MongoDB.

### 👤 User Profile
- `GET /api/users/profile`: Get current user details.
- `PUT /api/users/profile`: Update account settings.

---

## 🛡️ Security Features
- **JWT Authorization**: All sensitive routes are protected via custom `authMiddleware`.
- **Password Hashing**: Salted hashing using Bcrypt.
- **Audit Logging**: Every SOS event and major user action is logged in the `Activity` collection.
