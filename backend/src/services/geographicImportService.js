import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import GeographicImportRun from '../models/GeographicImportRun.js';
import City from '../models/City.js';
import GeographicFeature from '../models/GeographicFeature.js';
import { SUPPORTED_CITIES } from '../config/safeRouteConfig.js';
import {
    geometryIntersectsCityBounds,
    getOsmFeatureCategories,
    overpassElementsToGeoJson,
    validateCityBoundingBox,
} from './osmBoundingBoxImportService.js';

const BATCH_SIZE = 500;
const IMPORT_LEASE_MS = 15 * 60 * 1000;
const DEFAULT_CACHE_DIRECTORY = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../data/osm-import-cache',
);

const getCityDocument = (city) => ({
    cityId: city.id,
    name: city.name,
    state: city.state,
    country: city.country,
    timezone: city.timezone,
});

const normalizeGeoJsonFeature = (feature, cityId, dataVersion, importRunId, importedAt) => {
    if (feature?.type !== 'Feature' || !feature.geometry || !feature.properties) return null;
    const properties = feature.properties;
    const rawId = properties['@id'] ?? properties.id;
    const typeFromId = String(rawId || '').match(/^(node|way|relation)\//)?.[1];
    const rawType = properties['@type'] ?? properties.type ?? typeFromId;
    const osmType = String(rawType || '').replace(/^.*\//, '').toLowerCase();
    const osmId = String(rawId || '').replace(/^(node|way|relation)\//, '');
    const tags = properties.tags || properties['@tags'] ||
        Object.fromEntries(Object.entries(properties).filter(([key]) => !key.startsWith('@')));
    if (!['node', 'way', 'relation'].includes(osmType) || !osmId || !tags || typeof tags !== 'object') {
        return null;
    }
    if (!geometryIntersectsCityBounds(cityId, feature.geometry)) return false;
    const sourceTimestamp = properties['@timestamp'] ? new Date(properties['@timestamp']) : null;

    return {
        cityId,
        osmType,
        osmId,
        geometry: feature.geometry,
        tags,
        featureCategories: feature.featureCategories || getOsmFeatureCategories(tags),
        source: 'OpenStreetMap',
        sourceTimestamp: sourceTimestamp && Number.isFinite(sourceTimestamp.getTime())
            ? sourceTimestamp
            : null,
        importedAt,
        dataVersion,
        importRunId,
    };
};

const makeBulkOperation = (document) => ({
    updateOne: {
        filter: { cityId: document.cityId, osmType: document.osmType, osmId: document.osmId },
        update: { $set: document },
        upsert: true,
    },
});

const updateRun = (run, values, ImportRunModel) => ImportRunModel.updateOne(
    { _id: run._id, status: 'running' },
    { $set: { ...values, leaseUntil: new Date(Date.now() + IMPORT_LEASE_MS) } },
);

const updateCityStatus = async (city, status, details = {}, CityModel) => CityModel.updateOne(
    { cityId: city.id },
    {
        $set: {
            ...getCityDocument(city),
            featureImportStatus: status,
            ...details,
        },
    },
    { upsert: true },
);

const createRun = async ({
    cityId,
    mode,
    source,
    cachePath,
    recoverStaleRunId,
    ImportRunModel,
}) => {
    await ImportRunModel.init();
    const now = new Date();
    const activeRun = await ImportRunModel.findOne({ cityId, status: 'running' });
    if (activeRun) {
        if (activeRun.leaseUntil && activeRun.leaseUntil > now) {
            if (String(activeRun._id) !== String(recoverStaleRunId || '')) {
                throw new Error(
                    `An OSM import for ${cityId} is already running (run ${activeRun._id}). ` +
                    'If that process has stopped, retry with --recover-stale-run=<run-id>.',
                );
            }
            const recovered = await ImportRunModel.updateOne(
                { _id: activeRun._id, cityId, status: 'running' },
                {
                    $set: {
                        status: 'interrupted',
                        completedAt: now,
                        leaseUntil: null,
                        error: {
                            message: 'Explicitly recovered; confirm the previous import process has stopped.',
                        },
                    },
                },
            );
            if (!recovered.modifiedCount) {
                throw new Error(`Could not recover active OSM import ${activeRun._id}`);
            }
        } else {
            await ImportRunModel.updateOne(
                { _id: activeRun._id, status: 'running', leaseUntil: { $lte: now } },
                {
                    $set: {
                        status: 'interrupted',
                        completedAt: now,
                        leaseUntil: null,
                        error: { message: 'Import lease expired; resume from the cached raw response.' },
                    },
                },
            );
        }
    }
    const run = new ImportRunModel({
        cityId,
        status: 'running',
        mode,
        source,
        startedAt: now,
        leaseUntil: new Date(now.getTime() + IMPORT_LEASE_MS),
        rawCachePath: cachePath || null,
    });
    await run.save();
    return run;
};

const resumeRun = async ({ cityId, runId, ImportRunModel }) => {
    const run = runId
        ? await ImportRunModel.findOne({ _id: runId, cityId })
        : await ImportRunModel.findOne({
            cityId,
            status: { $in: ['failed', 'interrupted', 'running'] },
            rawCachePath: { $exists: true, $ne: null },
        }).sort({ startedAt: -1 });
    if (!run) throw new Error(`No resumable cached import exists for ${cityId}`);
    if (!run.rawCachePath) {
        throw new Error(`Import ${run._id} has no cached raw response to resume`);
    }
    try {
        await fs.access(run.rawCachePath);
    } catch {
        throw new Error(`Cached raw response for import ${run._id} is not available at "${run.rawCachePath}"`);
    }
    const now = new Date();
    if (run.status === 'running' && run.leaseUntil > now) {
        throw new Error(`Import ${run._id} is still active; refusing to run a duplicate`);
    }
    if (!['failed', 'interrupted', 'running'].includes(run.status)) {
        throw new Error(`Import ${run._id} is not resumable from status "${run.status}"`);
    }
    const statusFilter = run.status === 'running'
        ? { status: 'running', leaseUntil: { $lte: now } }
        : { status: run.status };
    const claimed = await ImportRunModel.updateOne(
        { _id: run._id, cityId, ...statusFilter },
        {
            $set: {
                status: 'running',
                completedAt: null,
                error: null,
                leaseUntil: new Date(now.getTime() + IMPORT_LEASE_MS),
                rawCacheAvailable: true,
            },
        },
    );
    if (!claimed.modifiedCount) {
        throw new Error(`Import ${run._id} was claimed by another process or is no longer resumable`);
    }
    return ImportRunModel.findById(run._id);
};

const cacheRawResponse = async (cachePath, payload) => {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    const temporaryPath = `${cachePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(payload), { flag: 'wx' });
    await fs.rename(temporaryPath, cachePath);
};

const validateRawPayload = (payload) => {
    if (!payload || !Array.isArray(payload.elements) || payload.remark) {
        throw new Error(
            `OSM response is incomplete${payload?.remark ? `: ${payload.remark}` : ''}; ` +
            'no existing geographic features were removed',
        );
    }
};

const readRawCache = async (cachePath) => {
    try {
        return JSON.parse(await fs.readFile(cachePath, 'utf8'));
    } catch (error) {
        throw new Error(`Could not read cached OSM response "${cachePath}": ${error.message}`);
    }
};

const aggregateCoverage = async (cityId, FeatureModel, importRunId) => {
    const groups = await FeatureModel.aggregate([
        { $match: { cityId, ...(importRunId ? { importRunId } : {}) } },
        { $unwind: '$featureCategories' },
        { $group: { _id: '$featureCategories', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(groups.map(({ _id, count }) => [_id, count]));
};

export const runGeographicImport = async ({
    cityId,
    mode = 'incremental',
    source,
    features,
    rawPayload,
    fetchRaw,
    resume = false,
    runId,
    recoverStaleRunId,
    cacheDirectory,
    dataVersion,
    models = {},
}) => {
    const CityModel = models.CityModel || City;
    const FeatureModel = models.FeatureModel || GeographicFeature;
    const ImportRunModel = models.ImportRunModel || GeographicImportRun;
    const city = SUPPORTED_CITIES.find(({ id }) => id === cityId);
    if (!city) throw new Error(`Unsupported city "${cityId}"`);
    if (!resume && !['incremental', 'fresh'].includes(mode)) {
        throw new Error(`Unsupported import mode "${mode}"`);
    }
    validateCityBoundingBox(cityId);

    const rawCacheBaseDirectory = cacheDirectory || (fetchRaw ? DEFAULT_CACHE_DIRECTORY : null);
    const rawCachePath = rawCacheBaseDirectory && !resume && (fetchRaw || rawPayload)
        ? path.join(rawCacheBaseDirectory, cityId, `${Date.now()}-${process.pid}-${randomUUID()}.json`)
        : null;
    const run = resume
        ? await resumeRun({ cityId, runId, ImportRunModel })
        : await createRun({
            cityId,
            mode,
            source,
            cachePath: rawCachePath,
            recoverStaleRunId,
            ImportRunModel,
        });
    const importMode = resume ? run.mode : mode;
    const importedAt = new Date();
    try {
        await updateCityStatus(city, 'importing', {
            featureImportSource: source || run.source,
            featureImportMessage: null,
        }, CityModel);
        let payload = rawPayload;
        let featureStream = features;
        let importSource = source || run.source;
        let version = dataVersion || String(run._id);

        if (resume) {
            payload = await readRawCache(run.rawCachePath);
            validateRawPayload(payload);
            featureStream = overpassElementsToGeoJson(payload.elements, cityId);
            importSource = run.source;
            version = dataVersion || payload.osm3s?.timestamp_osm_base || String(run._id);
        } else if (fetchRaw) {
            const response = await fetchRaw();
            payload = response.payload;
            validateRawPayload(payload);
            await cacheRawResponse(run.rawCachePath, payload);
            importSource = response.source || importSource;
            version = response.dataVersion || dataVersion ||
                payload.osm3s?.timestamp_osm_base || String(run._id);
            featureStream = overpassElementsToGeoJson(payload.elements, cityId);
            run.rawCacheAvailable = true;
            run.rawCachePath = rawCachePath;
            run.source = importSource;
            run.dataVersion = version;
            await run.save();
        } else if (payload) {
            validateRawPayload(payload);
            if (rawCachePath) await cacheRawResponse(rawCachePath, payload);
            featureStream = overpassElementsToGeoJson(payload.elements, cityId);
            run.rawCacheAvailable = Boolean(rawCachePath);
            run.rawCachePath = rawCachePath;
            run.dataVersion = dataVersion || payload.osm3s?.timestamp_osm_base || String(run._id);
            await run.save();
            version = run.dataVersion || String(run._id);
        }

        if (
            !featureStream ||
            (typeof featureStream[Symbol.asyncIterator] !== 'function' &&
                typeof featureStream[Symbol.iterator] !== 'function')
        ) {
            throw new Error('An OSM feature stream or cached Overpass response is required');
        }
        if (payload) validateRawPayload(payload);

        const seen = new Set();
        let operations = [];
        let normalizedFeatures = 0;
        let skippedFeatures = 0;
        let invalidFeatures = 0;
        let upsertedFeatures = 0;
        let modifiedFeatures = 0;
        const fetchedElements = payload?.elements?.length || 0;

        const flushBatch = async () => {
            if (!operations.length) return;
            const result = await FeatureModel.bulkWrite(operations, { ordered: false });
            upsertedFeatures += result.upsertedCount || 0;
            modifiedFeatures += result.modifiedCount || 0;
            operations = [];
            await updateRun(run, {
                'counts.fetchedElements': fetchedElements,
                'counts.normalizedFeatures': normalizedFeatures,
                'counts.skippedFeatures': skippedFeatures,
                'counts.invalidFeatures': invalidFeatures,
                'counts.upsertedFeatures': upsertedFeatures,
                'counts.modifiedFeatures': modifiedFeatures,
                dataVersion: version,
                rawCacheAvailable: run.rawCacheAvailable,
            }, ImportRunModel);
        };

        for await (const feature of featureStream) {
            const document = normalizeGeoJsonFeature(
                feature,
                cityId,
                version,
                String(run._id),
                importedAt,
            );
            if (document === false) {
                skippedFeatures += 1;
                continue;
            }
            if (!document) {
                skippedFeatures += 1;
                invalidFeatures += 1;
                continue;
            }
            const key = `${document.osmType}/${document.osmId}`;
            if (seen.has(key)) {
                skippedFeatures += 1;
                continue;
            }
            seen.add(key);
            normalizedFeatures += 1;
            operations.push(makeBulkOperation(document));
            if (operations.length >= BATCH_SIZE) await flushBatch();
        }
        await flushBatch();
        if (!normalizedFeatures) {
            throw new Error('OSM import produced no valid geographic features; existing data was preserved');
        }
        if (importMode === 'fresh' && invalidFeatures) {
            throw new Error(
                `Fresh import skipped ${invalidFeatures} malformed feature(s); ` +
                'existing data was preserved',
            );
        }

        const snapshotFilter = importMode === 'fresh' ? { cityId, importRunId: String(run._id) } : { cityId };
        const [totalFeatures, coverage, latestTimestamp] = await Promise.all([
            FeatureModel.countDocuments(snapshotFilter),
            aggregateCoverage(cityId, FeatureModel, importMode === 'fresh' ? String(run._id) : null),
            FeatureModel.aggregate([
                { $match: { ...snapshotFilter, sourceTimestamp: { $type: 'date' } } },
                { $group: { _id: null, latest: { $max: '$sourceTimestamp' } } },
            ]).then(([result]) => result?.latest || null),
        ]);
        let deletedFeatures = 0;
        if (importMode === 'fresh') {
            const deletion = await FeatureModel.deleteMany({
                cityId,
                importRunId: { $ne: String(run._id) },
            });
            deletedFeatures = deletion.deletedCount || 0;
        }
        await updateCityStatus(city, 'imported', {
            featureImportMessage: null,
            dataImportedAt: importedAt,
            featureCount: totalFeatures,
            coverage,
            osmDataTimestamp: latestTimestamp,
            featureImportSource: importSource,
            latestImportRunId: run._id,
        }, CityModel);
        const counts = {
            fetchedElements,
            normalizedFeatures,
            skippedFeatures,
            invalidFeatures,
            upsertedFeatures,
            modifiedFeatures,
            deletedFeatures,
            totalFeatures,
            categories: coverage,
        };
        await run.updateOne({
            $set: {
                status: 'completed',
                completedAt: new Date(),
                leaseUntil: null,
                source: importSource,
                dataVersion: version,
                counts,
                error: null,
            },
        });
        console.log(
            `Imported ${normalizedFeatures} ${importMode} features for ${city.name}; ` +
            `${upsertedFeatures} inserted, ${modifiedFeatures} updated, ` +
            `${deletedFeatures} removed; ${totalFeatures} total`,
        );
        return { runId: run._id, status: 'completed', counts, rawCachePath: run.rawCachePath };
    } catch (error) {
        const message = error.message.slice(0, 1000);
        await Promise.all([
            run.updateOne({
                $set: {
                    status: 'failed',
                    completedAt: new Date(),
                    leaseUntil: null,
                    error: { message, statusCode: error.statusCode || null },
                },
            }),
            updateCityStatus(city, 'failed', {
                featureImportMessage: message,
            }, CityModel),
        ]);
        throw error;
    }
};
