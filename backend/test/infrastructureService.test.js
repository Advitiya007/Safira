import assert from 'node:assert/strict';
import test from 'node:test';
import { getMlServiceSettings } from '../src/config/mlServiceConfig.js';
import {
    createInfrastructureService,
    thinCoordinates,
    toLonLat,
} from '../src/services/infrastructureService.js';

const ENABLED = {
    baseUrl: 'http://ml.test:8001',
    apiKey: 'super-secret-key',
    enabled: true,
    timeoutMs: 1000,
    modelScope: 'global',
};

// SYNTHETIC test doubles only: they exercise the HTTP bridge and are never stored or shown.
const analysis = {
    cityId: 'jalandhar',
    routes: [
        { id: 0, coordinates: [[31.3, 75.5], [31.31, 75.51]] },
        { id: 1, coordinates: [[31.3, 75.5], [31.305, 75.52], [31.31, 75.51]] },
    ],
};
const profilesPayload = {
    modelVersion: 'global-v1',
    scope: 'global',
    createdAt: '2026-01-01T00:00:00Z',
    clusters: [
        { clusterId: 0, name: 'Infrastructure-rich', level: 'rich', description: 'd0', share: 0.4 },
        { clusterId: 1, name: 'Infrastructure-sparse', level: 'sparse', description: 'd1', share: 0.6 },
    ],
    featuresUsed: ['road_length_m'],
    featureInfo: {},
    droppedFeatures: [],
    metrics: { silhouette: 0.3, daviesBouldin: 1.1 },
    disclaimer: 'not a safety rating',
};
const profilePayload = {
    modelVersion: 'global-v1',
    scope: 'global',
    cityId: 'jalandhar',
    routes: [{ routeId: 0, clusterShares: [], assignedCoveragePercent: 80 }],
    disclaimer: 'not a safety rating',
};

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

const makeService = (fetchImpl, overrides = {}) => createInfrastructureService({
    fetchImpl,
    getSettings: () => ENABLED,
    getAnalysis: async () => analysis,
    SegmentModel: { aggregate: async () => [{ _id: 'jalandhar', segments: 10, assigned: 10 }] },
    ...overrides,
});

const routingFetch = (calls) => async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/routes/profile')) return json(200, profilePayload);
    if (url.includes('/v1/model/profiles')) return json(200, profilesPayload);
    return json(404, {});
};

test('settings are disabled unless both URL and API key are set and the URL is http(s)', () => {
    assert.equal(getMlServiceSettings({}).enabled, false);
    assert.equal(getMlServiceSettings({ ML_SERVICE_URL: 'http://x:1' }).enabled, false);
    assert.equal(getMlServiceSettings({ ML_SERVICE_API_KEY: 'k' }).enabled, false);
    assert.equal(getMlServiceSettings({ ML_SERVICE_URL: 'ftp://x', ML_SERVICE_API_KEY: 'k' }).enabled, false);
    assert.equal(getMlServiceSettings({ ML_SERVICE_URL: 'not a url', ML_SERVICE_API_KEY: 'k' }).enabled, false);
    const settings = getMlServiceSettings({ ML_SERVICE_URL: 'http://x:8001/', ML_SERVICE_API_KEY: 'k' });
    assert.equal(settings.enabled, true);
    assert.equal(settings.baseUrl, 'http://x:8001');
    assert.equal(settings.modelScope, 'global');
});

test('coordinates are converted from [lat, lon] to GeoJSON [lon, lat] and invalid points dropped', () => {
    assert.deepEqual(toLonLat([[31.3, 75.5], [Number.NaN, 1], 'x', [31.4, 75.6]]), [[75.5, 31.3], [75.6, 31.4]]);
});

test('thinCoordinates keeps endpoints and respects the limit', () => {
    const line = Array.from({ length: 1000 }, (_, i) => [i, i]);
    const thinned = thinCoordinates(line, 50);
    assert.equal(thinned.length, 50);
    assert.deepEqual(thinned[0], line[0]);
    assert.deepEqual(thinned.at(-1), line.at(-1));
    assert.equal(thinCoordinates(line, 5000), line);
});

test('not configured: reports unavailable without calling the ML service', async () => {
    let called = false;
    const service = makeService(async () => { called = true; }, { getSettings: () => ({ enabled: false }) });
    const result = await service.getRouteInfrastructure('id', 'user');
    assert.equal(result.available, false);
    assert.equal(result.reason, 'not_configured');
    assert.equal(called, false);
    assert.equal((await service.getModelSummary()).reason, 'not_configured');
});

test('route profile: sends API key header and lon/lat coordinates, merges cluster legend', async () => {
    const calls = [];
    const service = makeService(routingFetch(calls));
    const result = await service.getRouteInfrastructure('abc', 'user1');

    assert.equal(result.available, true);
    assert.equal(result.modelVersion, 'global-v1');
    assert.equal(result.routes[0].routeId, 0);
    assert.equal(result.clusters[1].name, 'Infrastructure-sparse');

    const profileCall = calls.find(({ url }) => url.endsWith('/v1/routes/profile'));
    assert.equal(profileCall.options.method, 'POST');
    assert.equal(profileCall.options.headers['x-api-key'], ENABLED.apiKey);
    const body = JSON.parse(profileCall.options.body);
    assert.equal(body.cityId, 'jalandhar');
    assert.equal(body.scope, 'global');
    assert.deepEqual(body.routes[0].coordinates, [[75.5, 31.3], [75.51, 31.31]]);
    assert.equal(JSON.stringify(result).includes(ENABLED.apiKey), false);
});

test('route profile does not alter the stored analysis object', async () => {
    const frozen = structuredClone(analysis);
    const service = makeService(routingFetch([]), { getAnalysis: async () => frozen });
    await service.getRouteInfrastructure('abc', 'user1');
    assert.deepEqual(frozen, analysis);
});

test('ownership/validity errors from the analysis lookup still propagate', async () => {
    const service = makeService(routingFetch([]), {
        getAnalysis: async () => { throw Object.assign(new Error('Route analysis not found'), { statusCode: 404 }); },
    });
    await assert.rejects(service.getRouteInfrastructure('abc', 'other-user'), { statusCode: 404 });
});

test('ML failures degrade to available:false instead of throwing', async () => {
    const cases = [
        [async () => json(404, {}), 'model_not_trained'],
        [async () => json(401, {}), 'service_misconfigured'],
        [async () => json(503, {}), 'service_misconfigured'],
        [async () => json(422, {}), 'request_rejected'],
        [async () => json(500, {}), 'service_unavailable'],
        [async () => { throw new TypeError('fetch failed'); }, 'service_unavailable'],
    ];
    for (const [fetchImpl, reason] of cases) {
        const service = makeService(fetchImpl);
        const result = await service.getRouteInfrastructure('abc', 'user1');
        assert.equal(result.available, false, reason);
        assert.equal(result.reason, reason);
        assert.ok(result.message);
        assert.equal(JSON.stringify(result).includes(ENABLED.apiKey), false);
    }
});

test('a missing legend does not hide a successful route profile', async () => {
    const service = makeService(async (url) => (
        url.endsWith('/v1/routes/profile') ? json(200, profilePayload) : json(500, {})
    ));
    const result = await service.getRouteInfrastructure('abc', 'user1');
    assert.equal(result.available, true);
    assert.deepEqual(result.clusters, {});
});

test('model summary is cached between calls and exposes per-city segment coverage', async () => {
    const calls = [];
    let clock = 1000;
    const service = makeService(routingFetch(calls), { now: () => clock });
    const first = await service.getModelSummary();
    await service.getModelSummary();
    assert.equal(calls.filter(({ url }) => url.includes('/v1/model/profiles')).length, 1);
    assert.equal(first.available, true);
    assert.deepEqual(first.segmentCoverage, { jalandhar: { segments: 10, assigned: 10 } });

    clock += 6 * 60 * 1000;
    await service.getModelSummary();
    assert.equal(calls.filter(({ url }) => url.includes('/v1/model/profiles')).length, 2);
});

test('segment coverage failure does not break the model summary', async () => {
    const service = makeService(routingFetch([]), {
        SegmentModel: { aggregate: async () => { throw new Error('db down'); } },
    });
    const summary = await service.getModelSummary();
    assert.equal(summary.available, true);
    assert.equal(summary.segmentCoverage, null);
});
