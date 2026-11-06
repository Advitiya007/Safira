import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runGeographicImport } from '../src/services/geographicImportService.js';

const setPath = (target, key, value) => {
    const parts = key.split('.');
    let current = target;
    for (const part of parts.slice(0, -1)) {
        current[part] ??= {};
        current = current[part];
    }
    current[parts.at(-1)] = value;
};

const matches = (document, filter) => Object.entries(filter).every(([key, expected]) => {
    const actual = document[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        return Object.entries(expected).every(([operator, value]) => {
            if (operator === '$in') return value.includes(actual);
            if (operator === '$ne') return actual !== value;
            if (operator === '$lte') return actual <= value;
            if (operator === '$exists') return Boolean(actual) === value;
            return false;
        });
    }
    return actual === expected;
});

const makeModels = (initialFeatures = []) => {
    const runs = [];
    const features = initialFeatures.map((feature) => ({ ...feature }));
    const cityDocuments = new Map();
    let nextRunId = 1;
    let failBulkWrite = false;
    let failAggregate = false;

    class RunQuery {
        constructor(filter) {
            this.filter = filter;
            this.sortOptions = null;
        }

        sort(options) {
            this.sortOptions = options;
            return this;
        }

        then(resolve, reject) {
            let result = runs.find((run) => matches(run, this.filter)) || null;
            if (result && this.sortOptions) {
                const [[field, direction]] = Object.entries(this.sortOptions);
                result = runs
                    .filter((run) => matches(run, this.filter))
                    .sort((first, second) => direction * (
                        new Date(first[field]).getTime() - new Date(second[field]).getTime()
                    ))
                    .at(0) || null;
            }
            return Promise.resolve(result).then(resolve, reject);
        }
    }

    class FakeRun {
        constructor(properties) {
            Object.assign(this, properties, { _id: String(nextRunId++) });
        }

        async save() {
            if (!runs.includes(this)) runs.push(this);
            return this;
        }

        async updateOne(update) {
            for (const [key, value] of Object.entries(update.$set || {})) setPath(this, key, value);
            return { modifiedCount: 1 };
        }

        static async init() {}

        static findOne(filter) {
            return new RunQuery(filter);
        }

        static async findById(id) {
            return runs.find((run) => run._id === String(id)) || null;
        }

        static async updateOne(filter, update) {
            const run = runs.find((candidate) => matches(candidate, filter));
            if (!run) return { modifiedCount: 0 };
            for (const [key, value] of Object.entries(update.$set || {})) setPath(run, key, value);
            return { modifiedCount: 1 };
        }
    }

    class FakeFeature {
        static async bulkWrite(operations) {
            if (failBulkWrite) throw new Error('simulated database failure');
            let upsertedCount = 0;
            let modifiedCount = 0;
            for (const { updateOne } of operations) {
                const existing = features.find((feature) => matches(feature, updateOne.filter));
                if (existing) {
                    Object.assign(existing, updateOne.update.$set);
                    modifiedCount += 1;
                } else {
                    features.push({ ...updateOne.update.$set });
                    upsertedCount += 1;
                }
            }
            return { upsertedCount, modifiedCount };
        }

        static async deleteMany(filter) {
            const before = features.length;
            for (let index = features.length - 1; index >= 0; index -= 1) {
                if (features[index].cityId === filter.cityId && features[index].importRunId !== filter.importRunId.$ne) {
                    features.splice(index, 1);
                }
            }
            return { deletedCount: before - features.length };
        }

        static async countDocuments(filter) {
            return features.filter((feature) => matches(feature, filter)).length;
        }

        static async aggregate(pipeline) {
            if (failAggregate) throw new Error('simulated aggregation failure');
            const match = pipeline.find((stage) => stage.$match)?.$match || {};
            const matchedFeatures = features.filter((feature) => matches(feature, match));
            if (pipeline.some((stage) => stage.$unwind)) {
                const counts = new Map();
                for (const feature of matchedFeatures) {
                    for (const category of feature.featureCategories || []) {
                        counts.set(category, (counts.get(category) || 0) + 1);
                    }
                }
                return [...counts].map(([_id, count]) => ({ _id, count }));
            }
            const dates = matchedFeatures.map((feature) => feature.sourceTimestamp).filter(Boolean);
            return dates.length ? [{ latest: new Date(Math.max(...dates.map(Number))) }] : [];
        }
    }

    const CityModel = {
        async updateOne(filter, update) {
            const document = cityDocuments.get(filter.cityId) || {};
            Object.assign(document, update.$set || {});
            cityDocuments.set(filter.cityId, document);
            return { modifiedCount: 1 };
        },
    };

    return {
        models: { CityModel, FeatureModel: FakeFeature, ImportRunModel: FakeRun },
        runs,
        features,
        cityDocuments,
        setFailBulkWrite(value) {
            failBulkWrite = value;
        },
        setFailAggregate(value) {
            failAggregate = value;
        },
        seedRun(properties) {
            const run = new FakeRun(properties);
            runs.push(run);
            return run;
        },
    };
};

const rawPayload = (elements = []) => ({
    elements,
    osm3s: { timestamp_osm_base: '2025-01-02T03:04:05Z' },
});

const policeNode = (id, longitude = 74.95, latitude = 30.20) => ({
    type: 'node',
    id,
    lat: latitude,
    lon: longitude,
    timestamp: '2024-12-01T00:00:00Z',
    tags: { amenity: 'police', name: `Station ${id}` },
});

test('imports and upserts normalized features with persistent counts', async () => {
    const fake = makeModels();
    const result = await runGeographicImport({
        cityId: 'bathinda',
        source: 'Overpass API',
        rawPayload: rawPayload([policeNode(1), policeNode(1)]),
        models: fake.models,
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.counts.normalizedFeatures, 1);
    assert.equal(result.counts.totalFeatures, 1);
    assert.equal(fake.features[0].osmType, 'node');
    assert.equal(fake.features[0].osmId, '1');
    assert.equal(fake.features[0].tags.amenity, 'police');
    assert.equal(fake.runs[0].status, 'completed');
    assert.equal(fake.cityDocuments.get('bathinda').featureImportStatus, 'imported');
});

test('repeated incremental imports update the same OSM element instead of duplicating it', async () => {
    const fake = makeModels();
    const first = rawPayload([policeNode(10)]);
    await runGeographicImport({
        cityId: 'bathinda',
        source: 'Overpass API',
        rawPayload: first,
        models: fake.models,
    });
    const second = rawPayload([{
        ...policeNode(10),
        tags: { amenity: 'police', name: 'Updated station' },
    }]);
    await runGeographicImport({
        cityId: 'bathinda',
        source: 'Overpass API',
        rawPayload: second,
        models: fake.models,
    });

    assert.equal(fake.features.length, 1);
    assert.equal(fake.features[0].tags.name, 'Updated station');
});

test('caches a fetched response before processing and resumes it without another fetch', async () => {
    const fake = makeModels([{
        cityId: 'bathinda',
        osmType: 'node',
        osmId: 'stale',
        importRunId: 'prior',
    }]);
    const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'safeher-osm-cache-'));
    let fetchCount = 0;
    try {
        fake.setFailBulkWrite(true);
        await assert.rejects(runGeographicImport({
            cityId: 'bathinda',
            mode: 'fresh',
            source: 'Overpass API',
            cacheDirectory,
            fetchRaw: async () => {
                fetchCount += 1;
                return { payload: rawPayload([policeNode(2)]), source: 'test endpoint' };
            },
            models: fake.models,
        }), /simulated database failure/);
        assert.equal(fake.runs[0].rawCacheAvailable, true);
        assert.equal(fake.features[0].osmId, 'stale');
        assert.ok(await fs.stat(fake.runs[0].rawCachePath));

        fake.setFailBulkWrite(false);
        const result = await runGeographicImport({
            cityId: 'bathinda',
            resume: true,
            models: fake.models,
        });
        assert.equal(result.status, 'completed');
        assert.equal(fetchCount, 1);
        assert.equal(fake.features.length, 1);
        assert.equal(fake.features[0].osmId, '2');
    } finally {
        await fs.rm(cacheDirectory, { recursive: true, force: true });
    }
});

test('a failed fetch preserves previously imported features', async () => {
    const original = {
        cityId: 'bathinda',
        osmType: 'node',
        osmId: 'existing',
        importRunId: 'prior',
    };
    const fake = makeModels([original]);
    await assert.rejects(runGeographicImport({
        cityId: 'bathinda',
        source: 'Overpass API',
        fetchRaw: async () => { throw new Error('upstream unavailable'); },
        models: fake.models,
    }), /upstream unavailable/);

    assert.deepEqual(fake.features, [original]);
    assert.equal(fake.runs[0].status, 'failed');
    assert.equal(fake.cityDocuments.get('bathinda').featureImportStatus, 'failed');
});

test('fresh imports remove stale records only after successful processing', async () => {
    const stale = {
        cityId: 'bathinda',
        osmType: 'node',
        osmId: 'old',
        importRunId: 'prior',
    };
    const fake = makeModels([stale]);
    await runGeographicImport({
        cityId: 'bathinda',
        mode: 'fresh',
        source: 'Overpass API',
        rawPayload: rawPayload([policeNode(3)]),
        models: fake.models,
    });

    assert.equal(fake.features.length, 1);
    assert.equal(fake.features[0].osmId, '3');
});

test('fresh import failures before publication preserve the previous dataset', async () => {
    const stale = {
        cityId: 'bathinda',
        osmType: 'node',
        osmId: 'old',
        importRunId: 'prior',
    };
    const fake = makeModels([stale]);
    fake.setFailAggregate(true);
    await assert.rejects(runGeographicImport({
        cityId: 'bathinda',
        mode: 'fresh',
        source: 'Overpass API',
        rawPayload: rawPayload([policeNode(6)]),
        models: fake.models,
    }), /simulated aggregation failure/);

    assert.ok(fake.features.some((feature) => feature.osmId === 'old'));
    assert.equal(fake.runs[0].status, 'failed');
});

test('an incomplete fresh response does not delete existing features', async () => {
    const stale = {
        cityId: 'bathinda',
        osmType: 'node',
        osmId: 'old',
        importRunId: 'prior',
    };
    const fake = makeModels([stale]);
    await assert.rejects(runGeographicImport({
        cityId: 'bathinda',
        mode: 'fresh',
        source: 'Overpass API',
        rawPayload: { ...rawPayload([]), remark: 'query timed out' },
        models: fake.models,
    }), /incomplete.*query timed out/);
    assert.deepEqual(fake.features, [stale]);
});

test('a second import for the same city is rejected while the first is running', async () => {
    const fake = makeModels();
    const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'safeher-osm-lock-'));
    let finishFetch;
    try {
        const firstImport = runGeographicImport({
            cityId: 'bathinda',
            source: 'Overpass API',
            cacheDirectory,
            fetchRaw: () => new Promise((resolve) => { finishFetch = resolve; }),
            models: fake.models,
        });
        while (!finishFetch) await new Promise((resolve) => setImmediate(resolve));

        await assert.rejects(runGeographicImport({
            cityId: 'bathinda',
            source: 'Overpass API',
            rawPayload: rawPayload([policeNode(4)]),
            models: fake.models,
        }), /already running/);
        finishFetch({ payload: rawPayload([policeNode(5)]), source: 'test endpoint' });
        await firstImport;
    } finally {
        await fs.rm(cacheDirectory, { recursive: true, force: true });
    }
});

test('an explicitly identified abandoned running import can be recovered before a new fetch', async () => {
    const fake = makeModels();
    const staleRun = fake.seedRun({
        cityId: 'bathinda',
        status: 'running',
        mode: 'fresh',
        source: 'Overpass API',
        startedAt: new Date(),
        leaseUntil: new Date(Date.now() + 60_000),
    });

    const result = await runGeographicImport({
        cityId: 'bathinda',
        source: 'Overpass API',
        rawPayload: rawPayload([policeNode(7)]),
        recoverStaleRunId: staleRun._id,
        models: fake.models,
    });

    assert.equal(staleRun.status, 'interrupted');
    assert.equal(result.status, 'completed');
    assert.equal(fake.features.length, 1);
});
