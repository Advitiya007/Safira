import { CITY_BOUNDING_BOXES } from '../config/safeRouteConfig.js';

const RELEVANT_AMENITIES = [
    'restaurant',
    'cafe',
    'fast_food',
    'pharmacy',
    'hospital',
    'clinic',
    'police',
    'fuel',
    'bus_station',
];

export const validateCityBoundingBox = (cityId, boxes = CITY_BOUNDING_BOXES) => {
    const box = boxes[cityId];
    if (!box) throw new Error(`No geographic bounding box is configured for "${cityId}"`);
    const { south, west, north, east } = box;
    if (
        ![south, west, north, east].every(Number.isFinite) ||
        south < -90 || north > 90 || west < -180 || east > 180 ||
        south >= north || west >= east
    ) {
        throw new Error(`Invalid geographic bounding box configured for "${cityId}"`);
    }
    return box;
};

export const isPointWithinCityBounds = (cityId, latitude, longitude) => {
    const { south, west, north, east } = validateCityBoundingBox(cityId);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    return latitude >= south && latitude <= north && longitude >= west && longitude <= east;
};

const collectPositions = (coordinates, positions = []) => {
    if (
        Array.isArray(coordinates) &&
        coordinates.length >= 2 &&
        typeof coordinates[0] === 'number' &&
        typeof coordinates[1] === 'number'
    ) {
        positions.push(coordinates);
        return positions;
    }
    if (Array.isArray(coordinates)) {
        coordinates.forEach((coordinate) => collectPositions(coordinate, positions));
    }
    return positions;
};

export const geometryIntersectsCityBounds = (cityId, geometry) => {
    const { south, west, north, east } = validateCityBoundingBox(cityId);
    if (!['Point', 'LineString', 'Polygon', 'MultiLineString', 'MultiPolygon'].includes(geometry?.type)) return false;
    const positions = collectPositions(geometry?.coordinates);
    if (!positions.length || positions.some(([longitude, latitude]) => (
        !Number.isFinite(longitude) || !Number.isFinite(latitude) ||
        longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90
    ))) return false;
    const longitudes = positions.map(([longitude]) => longitude);
    const latitudes = positions.map(([, latitude]) => latitude);
    return Math.min(...longitudes) <= east && Math.max(...longitudes) >= west &&
        Math.min(...latitudes) <= north && Math.max(...latitudes) >= south;
};

export const getOsmFeatureCategories = (tags = {}) => {
    const categories = [];
    if (tags.highway && tags.highway !== 'street_lamp' && tags.highway !== 'bus_stop') {
        categories.push('roads');
    }
    if ((tags.shop && tags.shop !== 'no') || [
        'restaurant', 'cafe', 'fast_food', 'pub', 'bar', 'food_court',
        'marketplace', 'pharmacy', 'hospital', 'clinic', 'fuel',
    ].includes(tags.amenity)) {
        categories.push('activity');
    }
    if (tags.amenity === 'police' || ['hospital', 'clinic', 'pharmacy'].includes(tags.amenity)) {
        categories.push('emergency');
    }
    if (
        tags.public_transport ||
        tags.highway === 'bus_stop' ||
        ['station', 'halt', 'tram_stop'].includes(tags.railway) ||
        tags.amenity === 'bus_station'
    ) {
        categories.push('publicTransport');
    }
    if (tags.highway === 'street_lamp' || tags.lit) categories.push('lighting');
    if (tags.man_made === 'surveillance') categories.push('surveillance');
    return categories;
};

const toGeoJsonFeature = (element) => {
    if (!['node', 'way', 'relation'].includes(element.type) || !element.id || !element.tags) return null;
    let geometry;
    if (element.type === 'node') {
        if (!Number.isFinite(element.lat) || !Number.isFinite(element.lon)) return null;
        geometry = { type: 'Point', coordinates: [element.lon, element.lat] };
    } else if (element.type === 'relation') {
        const lines = (element.members || [])
            .filter((member) => Array.isArray(member.geometry) && member.geometry.length >= 2)
            .map((member) => member.geometry.map(({ lon, lat }) => [lon, lat]))
            .filter((coordinates) => coordinates.every(([longitude, latitude]) => (
                Number.isFinite(longitude) && Number.isFinite(latitude)
            )));
        if (lines.length) {
            geometry = { type: 'MultiLineString', coordinates: lines };
        } else if (Number.isFinite(element.center?.lat) && Number.isFinite(element.center?.lon)) {
            geometry = { type: 'Point', coordinates: [element.center.lon, element.center.lat] };
        } else {
            return null;
        }
    } else {
        const coordinates = element.geometry?.map(({ lon, lat }) => [lon, lat]);
        if (
            !coordinates ||
            coordinates.length < 2 ||
            coordinates.some(([longitude, latitude]) => !Number.isFinite(longitude) || !Number.isFinite(latitude))
        ) return null;
        geometry = { type: 'LineString', coordinates };
    }
    return {
        type: 'Feature',
        properties: {
            '@type': element.type,
            '@id': String(element.id),
            '@timestamp': element.timestamp,
            tags: element.tags,
        },
        geometry,
    };
};

export const overpassElementsToGeoJson = (elements, cityId) => {
    const unique = new Map();
    for (const element of elements || []) {
        const feature = toGeoJsonFeature(element);
        if (!feature || !geometryIntersectsCityBounds(cityId, feature.geometry)) continue;
        if (!getOsmFeatureCategories(feature.properties.tags).length) continue;
        unique.set(`${feature.properties['@type']}/${feature.properties['@id']}`, feature);
    }
    return [...unique.values()];
};

export const buildCityOverpassQuery = (cityId) => {
    const { south, west, north, east } = validateCityBoundingBox(cityId);
    const bbox = `${south},${west},${north},${east}`;
    const selectors = [
        '["highway"]',
        '["highway"="street_lamp"]',
        '["highway"="bus_stop"]',
        '["shop"]',
        [`["amenity"~"^(${RELEVANT_AMENITIES.join('|')})$"]`],
        '["public_transport"]',
        '["railway"~"^(station|halt|tram_stop)$"]',
        '["man_made"="surveillance"]',
        '["lit"]',
    ].flat();
    const statements = selectors.flatMap((selector) => (
        [`node${selector}(${bbox});`, `way${selector}(${bbox});`, `relation${selector}(${bbox});`]
    ));
    return `[out:json][timeout:180];(${statements.join('')});out meta geom;`;
};

const RETRYABLE_OVERPASS_STATUSES = new Set([429, 502, 503, 504]);
const DEFAULT_RETRY_OPTIONS = {
    maxAttempts: 4,
    initialDelayMs: 2000,
    maxDelayMs: 30000,
};

const retryDelayFromHeader = (retryAfter, now = Date.now()) => {
    if (!retryAfter) return null;
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(retryAfter) - now;
    return Number.isFinite(delay) && delay > 0 ? delay : null;
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const fetchCityOverpassFeatures = async (
    cityId,
    {
        fetchImpl = fetch,
        endpoint,
        endpoints,
        maxAttempts = Number(process.env.OVERPASS_MAX_ATTEMPTS) || DEFAULT_RETRY_OPTIONS.maxAttempts,
        initialDelayMs = DEFAULT_RETRY_OPTIONS.initialDelayMs,
        maxDelayMs = DEFAULT_RETRY_OPTIONS.maxDelayMs,
        timeoutMs = Number(process.env.OVERPASS_TIMEOUT_MS) || 180_000,
        sleep = wait,
    } = {},
) => {
    const { payload, source, attempts } = await fetchCityOverpassResponse(cityId, {
        fetchImpl,
        endpoint,
        endpoints,
        maxAttempts,
        initialDelayMs,
        maxDelayMs,
        timeoutMs,
        sleep,
    });
    return {
        features: overpassElementsToGeoJson(payload.elements, cityId),
        timestamp: payload.osm3s?.timestamp_osm_base || payload.timestamp_osm_base || null,
        source,
        attempts,
    };
};

const getOverpassEndpoints = ({ endpoint, endpoints }) => {
    const configuredEndpoints = endpoints || [
        ...(process.env.OVERPASS_API_URLS || '').split(','),
        endpoint || process.env.OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter',
    ];
    const uniqueEndpoints = [...new Set(configuredEndpoints.map((value) => value.trim()).filter(Boolean))];
    if (!uniqueEndpoints.length) throw new Error('At least one Overpass endpoint must be configured');
    for (const value of uniqueEndpoints) {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error(`Unsupported Overpass endpoint protocol "${url.protocol}"`);
        }
    }
    return uniqueEndpoints;
};

export const fetchCityOverpassResponse = async (
    cityId,
    {
        fetchImpl = fetch,
        endpoint,
        endpoints,
        maxAttempts = Number(process.env.OVERPASS_MAX_ATTEMPTS) || DEFAULT_RETRY_OPTIONS.maxAttempts,
        initialDelayMs = DEFAULT_RETRY_OPTIONS.initialDelayMs,
        maxDelayMs = DEFAULT_RETRY_OPTIONS.maxDelayMs,
        timeoutMs = Number(process.env.OVERPASS_TIMEOUT_MS) || 180_000,
        sleep = wait,
    } = {},
) => {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw new Error('Overpass maxAttempts must be a positive integer');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error('Overpass timeoutMs must be a positive number');
    }
    const overpassEndpoints = getOverpassEndpoints({ endpoint, endpoints });
    const query = buildCityOverpassQuery(cityId);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const currentEndpoint = overpassEndpoints[(attempt - 1) % overpassEndpoints.length];
        let response;
        let failure;
        try {
            response = await fetchImpl(currentEndpoint, {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'user-agent': process.env.OVERPASS_USER_AGENT ||
                        'SafeHer/1.0 (OSM import; https://github.com/PriyanshCG/safeHer_India)',
                },
                body: new URLSearchParams({ data: query }),
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (error) {
            failure = new Error(`Overpass request failed for ${cityId}: ${error.message}`);
        }

        if (response && !response.ok) {
            const responseBody = await response.text().catch(() => '');
            const detail = responseBody.replace(/\s+/g, ' ').trim().slice(0, 300);
            failure = new Error(
                `Overpass request failed for ${cityId}: HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
            );
            failure.statusCode = response.status;
            failure.retryable = RETRYABLE_OVERPASS_STATUSES.has(response.status);
            failure.retryAfter = response.headers?.get?.('retry-after');
        }

        if (response?.ok) {
            let payload;
            try {
                payload = await response.json();
            } catch (error) {
                throw new Error(`Overpass returned invalid JSON for ${cityId}: ${error.message}`);
            }
            if (!Array.isArray(payload.elements) || payload.remark) {
                const detail = payload.remark ? `: ${payload.remark}` : '';
                failure = new Error(`Overpass returned incomplete data for ${cityId}${detail}`);
                failure.retryable = /timeout|busy|capacity|rate limit|too many requests/i.test(
                    payload.remark || '',
                );
            } else {
                return {
                    payload,
                    source: currentEndpoint,
                    attempts: attempt,
                };
            }
        }

        if (!failure) throw new Error(`Overpass request failed for ${cityId}`);
        const retryable = failure.retryable ?? true;
        if (!retryable || attempt === maxAttempts) {
            const error = new Error(
                `${failure.message}${retryable ? ` (after ${attempt} attempt${attempt === 1 ? '' : 's'})` : ''}`,
                { cause: failure },
            );
            error.statusCode = failure.statusCode || null;
            throw error;
        }

        const backoffDelay = Math.min(initialDelayMs * (2 ** (attempt - 1)), maxDelayMs);
        const retryAfterDelay = retryDelayFromHeader(failure.retryAfter);
        const delay = Math.min(Math.max(backoffDelay, retryAfterDelay || 0), maxDelayMs);
        console.warn(
            `Overpass request for ${cityId} failed on attempt ${attempt}/${maxAttempts}; ` +
            `retrying via ${overpassEndpoints[attempt % overpassEndpoints.length]} in ${delay}ms: ` +
            failure.message,
        );
        await sleep(delay);
    }
    throw new Error(`Overpass request failed for ${cityId} without a response`);
};
