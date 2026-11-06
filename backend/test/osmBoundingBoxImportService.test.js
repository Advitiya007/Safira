import assert from 'node:assert/strict';
import test from 'node:test';
import { CITY_BOUNDING_BOXES } from '../src/config/safeRouteConfig.js';
import GeographicFeature from '../src/models/GeographicFeature.js';
import {
    buildCityOverpassQuery,
    fetchCityOverpassFeatures,
    fetchCityOverpassResponse,
    geometryIntersectsCityBounds,
    isPointWithinCityBounds,
    overpassElementsToGeoJson,
    validateCityBoundingBox,
} from '../src/services/osmBoundingBoxImportService.js';
import { isGeographicDataAvailable } from '../src/services/geographicDataService.js';
import { isRouteInsideCityCoverage } from '../src/services/safeRouteService.js';

test('all supported cities have valid, centralized geographic bounding boxes', () => {
    for (const [cityId, box] of Object.entries(CITY_BOUNDING_BOXES)) {
        assert.deepEqual(validateCityBoundingBox(cityId), box);
        assert.equal(isPointWithinCityBounds(
            cityId,
            (box.south + box.north) / 2,
            (box.west + box.east) / 2,
        ), true);
    }
    assert.deepEqual(Object.keys(CITY_BOUNDING_BOXES).sort(), ['bathinda', 'delhi', 'jalandhar']);
});

test('invalid and unsupported bounding boxes fail validation', () => {
    assert.throws(() => validateCityBoundingBox('missing'), /No geographic bounding box/);
    assert.throws(
        () => validateCityBoundingBox('broken', { broken: { south: 31, west: 75, north: 30, east: 76 } }),
        /Invalid geographic bounding box/,
    );
    assert.throws(
        () => validateCityBoundingBox('broken', { broken: { south: -91, west: 75, north: 30, east: 76 } }),
        /Invalid geographic bounding box/,
    );
});

test('Overpass queries use configured city bounds and request supported OSM categories', () => {
    const query = buildCityOverpassQuery('bathinda');
    assert.match(query, /\(30\.11,74\.83,30\.31,75\.05\)/);
    for (const tag of ['highway', 'shop', 'amenity', 'public_transport', 'street_lamp', 'surveillance', 'lit']) {
        assert.ok(query.includes(tag), `${tag} query missing`);
    }
    assert.match(query, /out meta geom/);
});

test('Overpass features are filtered to configured coverage and deduplicated by element type and ID', () => {
    const duplicateWay = {
        type: 'way',
        id: 22,
        tags: { highway: 'residential', lit: 'yes' },
        geometry: [{ lat: 31.32, lon: 75.56 }, { lat: 31.33, lon: 75.57 }],
    };
    const features = overpassElementsToGeoJson([
        duplicateWay,
        { ...duplicateWay, tags: { highway: 'primary' } },
        { ...duplicateWay, id: 23, geometry: [{ lat: 32, lon: 75.56 }, { lat: 32.1, lon: 75.57 }] },
        { type: 'node', id: 22, lat: 31.32, lon: 75.56, tags: { shop: 'convenience' } },
    ], 'jalandhar');

    assert.equal(features.length, 2);
    assert.deepEqual(
        features.map((feature) => `${feature.properties['@type']}/${feature.properties['@id']}`).sort(),
        ['node/22', 'way/22'],
    );
    assert.equal(features.find((feature) => feature.properties['@type'] === 'way').properties.tags.highway, 'primary');
    assert.equal(geometryIntersectsCityBounds('jalandhar', {
        type: 'LineString',
        coordinates: [[75.46, 31.32], [75.48, 31.32]],
    }), true);
});

test('mapped OSM relation geometry is retained for relation-based facilities', () => {
    const [feature] = overpassElementsToGeoJson([{
        type: 'relation',
        id: 901,
        tags: { amenity: 'hospital', name: 'Mapped hospital' },
        members: [{
            type: 'way',
            role: 'outer',
            geometry: [{ lat: 28.62, lon: 77.21 }, { lat: 28.63, lon: 77.22 }],
        }],
    }], 'delhi');

    assert.equal(feature.properties['@type'], 'relation');
    assert.equal(feature.geometry.type, 'MultiLineString');
    assert.deepEqual(feature.geometry.coordinates, [[[77.21, 28.62], [77.22, 28.63]]]);
});

test('Overpass fetch errors and incomplete responses are surfaced', async () => {
    let requestOptions;
    await assert.rejects(
        fetchCityOverpassFeatures('delhi', {
            fetchImpl: async (_url, options) => {
                requestOptions = options;
                return { ok: false, status: 429, text: async () => 'rate limit' };
            },
        }),
        /HTTP 429: rate limit/,
    );
    assert.equal(requestOptions.method, 'POST');
    assert.equal(requestOptions.headers.accept, 'application/json');
    assert.match(requestOptions.headers['user-agent'], /^SafeHer\//);
    await assert.rejects(
        fetchCityOverpassFeatures('delhi', {
            fetchImpl: async () => ({ ok: true, json: async () => ({ remark: 'timeout' }) }),
        }),
        /incomplete data.*timeout/,
    );
    await assert.rejects(
        fetchCityOverpassFeatures('delhi', {
            fetchImpl: async () => { throw new Error('network unavailable'); },
        }),
        /Overpass request failed.*network unavailable/,
    );
});

test('Overpass capacity responses retry with bounded exponential backoff before succeeding', async () => {
    let attempts = 0;
    const delays = [];
    const result = await fetchCityOverpassFeatures('jalandhar', {
        maxAttempts: 4,
        initialDelayMs: 2000,
        maxDelayMs: 10000,
        sleep: async (delay) => delays.push(delay),
        fetchImpl: async () => {
            attempts += 1;
            if (attempts < 3) {
                return {
                    ok: false,
                    status: 502,
                    headers: { get: () => null },
                    text: async () => 'Overpass server at capacity',
                };
            }
            return {
                ok: true,
                json: async () => ({ elements: [], osm3s: { timestamp_osm_base: 'now' } }),
            };
        },
    });

    assert.equal(attempts, 3);
    assert.deepEqual(delays, [2000, 4000]);
    assert.deepEqual(result.features, []);
    assert.equal(result.timestamp, 'now');
});

test('Overpass retries honor Retry-After and stop after the configured attempt count', async () => {
    let attempts = 0;
    const delays = [];
    await assert.rejects(
        fetchCityOverpassFeatures('bathinda', {
            maxAttempts: 3,
            initialDelayMs: 1000,
            maxDelayMs: 10000,
            sleep: async (delay) => delays.push(delay),
            fetchImpl: async () => {
                attempts += 1;
                return {
                    ok: false,
                    status: 429,
                    headers: { get: () => '5' },
                    text: async () => 'rate limited',
                };
            },
        }),
        /HTTP 429: rate limited \(after 3 attempts\)/,
    );
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [5000, 5000]);
});

test('Overpass switches to a configured fallback endpoint after a transient failure', async () => {
    const calls = [];
    const result = await fetchCityOverpassResponse('bathinda', {
        endpoints: [
            'https://overpass-one.example/api/interpreter',
            'https://overpass-two.example/api/interpreter',
        ],
        maxAttempts: 2,
        sleep: async () => {},
        fetchImpl: async (url) => {
            calls.push(url);
            if (calls.length === 1) {
                return {
                    ok: false,
                    status: 503,
                    headers: { get: () => null },
                    text: async () => 'temporarily unavailable',
                };
            }
            return { ok: true, json: async () => ({ elements: [] }) };
        },
    });

    assert.deepEqual(calls, [
        'https://overpass-one.example/api/interpreter',
        'https://overpass-two.example/api/interpreter',
    ]);
    assert.equal(result.source, calls[1]);
    assert.equal(result.attempts, 2);
});

test('Overpass does not retry non-transient client errors', async () => {
    let attempts = 0;
    const delays = [];
    await assert.rejects(
        fetchCityOverpassFeatures('delhi', {
            sleep: async (delay) => delays.push(delay),
            fetchImpl: async () => {
                attempts += 1;
                return {
                    ok: false,
                    status: 400,
                    text: async () => 'invalid query',
                };
            },
        }),
        /HTTP 400: invalid query/,
    );
    assert.equal(attempts, 1);
    assert.deepEqual(delays, []);
});

test('feature availability does not depend on a stored administrative boundary', () => {
    assert.equal(isGeographicDataAvailable(null), false);
    assert.equal(isGeographicDataAvailable({ featureCount: 0, dataImportedAt: new Date() }), false);
    assert.equal(isGeographicDataAvailable({ featureCount: 5, dataImportedAt: new Date() }), true);
    assert.equal(GeographicFeature.schema.indexes().some(([index, options]) => (
        index.cityId === 1 && index.osmType === 1 && index.osmId === 1 && options.unique
    )), true);
});

test('route analysis coverage is constrained by each configured city bounding box', () => {
    assert.equal(isRouteInsideCityCoverage({
        coordinates: [[31.32, 75.56], [31.33, 75.57]],
    }, 'jalandhar'), true);
    assert.equal(isRouteInsideCityCoverage({
        coordinates: [[31.32, 75.56], [31.5, 75.57]],
    }, 'jalandhar'), false);
    assert.equal(isRouteInsideCityCoverage({ coordinates: [] }, 'jalandhar'), false);
});
