import assert from 'node:assert/strict';
import test from 'node:test';
import {
    canReplaceBoundary,
    normalizeCityBoundarySource,
    persistCityBoundary,
} from '../src/services/cityBoundaryImportService.js';

const jalandharCity = {
    type: 'Feature',
    properties: { town: 'Jalandhar', state: 'Punjab', ward_id: '1' },
    geometry: {
        type: 'Polygon',
        coordinates: [[
            [75.56, 31.32], [75.58, 31.32], [75.58, 31.35], [75.56, 31.35], [75.56, 31.32],
        ]],
    },
};

const makeManifest = (overrides = {}) => ({
    cityId: 'jalandhar',
    sourceType: 'official-municipal',
    boundaryType: 'municipal-limits',
    sourceName: 'Jalandhar Municipal GIS',
    sourceUrl: 'https://example.gov.in/jalandhar-boundary.geojson',
    sourceId: 'jalandhar-mc-boundary-2026',
    retrievedAt: '2026-10-01T00:00:00.000Z',
    license: 'Open Government Licence',
    licenseUrl: 'https://example.gov.in/license',
    verificationStatus: 'verified',
    verificationNotes: 'Municipal limits confirmed from the published Jalandhar municipal GIS metadata.',
    crs: 'EPSG:4326',
    identity: { cityField: 'town', cityValue: 'Jalandhar', stateField: 'state', stateValue: 'Punjab' },
    ...overrides,
});

const rectangle = (west, south, east, north, properties = {}) => ({
    type: 'Feature',
    properties,
    geometry: {
        type: 'Polygon',
        coordinates: [[
            [west, south], [east, south], [east, north], [west, north], [west, south],
        ]],
    },
});

test('verified municipal polygons normalize to WGS84 and retain source provenance', () => {
    const result = normalizeCityBoundarySource('jalandhar', jalandharCity, makeManifest());

    assert.equal(result.geometry.type, 'Polygon');
    assert.equal(result.metadata.sourceType, 'official-municipal');
    assert.equal(result.metadata.verificationStatus, 'verified');
    assert.equal(result.metadata.coordinateReferenceSystem, 'EPSG:4326');
    assert.equal(result.metadata.sourceId, 'jalandhar-mc-boundary-2026');
    assert.equal(result.metadata.license, 'Open Government Licence');
});

test('verified ward polygons are identity-checked, unioned, and checked for expected coverage', () => {
    const westWard = rectangle(75.56, 31.32, 75.58, 31.35, {
        town: 'Jalandhar', state: 'Punjab', ward_id: '1',
    });
    const eastWard = rectangle(75.58, 31.32, 75.60, 31.35, {
        town: 'Jalandhar', state: 'Punjab', ward_id: '2',
    });
    const manifest = makeManifest({
        sourceType: 'official-wards',
        boundaryType: 'ward-union',
        identity: {
            cityField: 'town',
            cityValue: 'Jalandhar',
            stateField: 'state',
            stateValue: 'Punjab',
            wardIdField: 'ward_id',
        },
        expectedFeatureCount: 2,
    });
    const result = normalizeCityBoundarySource('jalandhar', {
        type: 'FeatureCollection',
        features: [westWard, eastWard],
    }, manifest);

    assert.equal(result.geometry.type, 'Polygon');
    assert.equal(result.metadata.featureCount, 2);
    assert.equal(result.geometry.coordinates.length, 1);
    assert.ok(result.geometry.coordinates[0].length >= 5);
    assert.deepEqual(result.geometry.coordinates[0][0], result.geometry.coordinates[0].at(-1));
});

test('EPSG:3857 source coordinates are projected into WGS84', () => {
    const metersPerDegree = 6378137 * Math.PI / 180;
    const project = ([longitude, latitude]) => {
        const x = longitude * metersPerDegree;
        const y = 6378137 * Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));
        return [x, y];
    };
    const projectedFeature = {
        ...jalandharCity,
        geometry: {
            type: 'Polygon',
            coordinates: jalandharCity.geometry.coordinates.map((ring) => ring.map(project)),
        },
    };
    const result = normalizeCityBoundarySource(
        'jalandhar',
        projectedFeature,
        makeManifest({ crs: 'EPSG:3857' }),
    );

    assert.ok(Math.abs(result.geometry.coordinates[0][0][0] - 75.56) < 1e-8);
    assert.ok(Math.abs(result.geometry.coordinates[0][0][1] - 31.32) < 1e-8);
    assert.equal(result.metadata.coordinateReferenceSystem, 'EPSG:4326');
});

test('prototype study areas are explicitly labelled and carry their limitations', () => {
    const bathindaStudyArea = {
        type: 'Feature',
        properties: { study_area: 'Bathinda urban study extent' },
        geometry: {
            type: 'Polygon',
            coordinates: [[
                [74.90, 30.16], [75.00, 30.16], [75.00, 30.25], [74.90, 30.25], [74.90, 30.16],
            ]],
        },
    };
    const manifest = makeManifest({
        cityId: 'bathinda',
        sourceType: 'prototype-study-area',
        boundaryType: 'urban-study-area',
        sourceName: 'Bathinda prototype extent',
        sourceUrl: 'https://example.org/bathinda-study-area',
        sourceId: 'bathinda-prototype-v1',
        license: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        verificationStatus: 'prototype',
        verificationNotes: 'This is a research study area only, not a municipal limit or official administrative boundary.',
        crs: 'EPSG:4326',
        identity: undefined,
    });
    const result = normalizeCityBoundarySource('bathinda', bathindaStudyArea, manifest);

    assert.equal(result.metadata.sourceType, 'prototype-study-area');
    assert.equal(result.metadata.verificationStatus, 'prototype');
});

test('other administrative datasets require explicit city identity and are kept distinct', () => {
    const result = normalizeCityBoundarySource(
        'jalandhar',
        jalandharCity,
        makeManifest({
            sourceType: 'other-administrative',
            boundaryType: 'other-city-boundary',
            sourceName: 'Verified regional urban boundary dataset',
        }),
    );

    assert.equal(result.metadata.sourceType, 'other-administrative');
    assert.equal(result.metadata.verificationStatus, 'verified');
});

test('missing city geometry, mismatched identities, and incomplete ward sets are rejected', () => {
    assert.throws(
        () => normalizeCityBoundarySource('jalandhar', { type: 'FeatureCollection', features: [] }, makeManifest()),
        /contains no features/,
    );
    assert.throws(
        () => normalizeCityBoundarySource(
            'jalandhar',
            { ...jalandharCity, properties: { town: 'Jalandhar District', state: 'Punjab' } },
            makeManifest(),
        ),
        /Feature identity did not match/,
    );
    assert.throws(
        () => normalizeCityBoundarySource('jalandhar', {
            type: 'FeatureCollection',
            features: [
                { ...jalandharCity, properties: { town: 'Jalandhar', state: 'Punjab', ward_id: 'same' } },
                { ...jalandharCity, properties: { town: 'Jalandhar', state: 'Punjab', ward_id: 'same' } },
            ],
        }, makeManifest({
            sourceType: 'official-wards',
            boundaryType: 'ward-union',
            identity: {
                cityField: 'town',
                cityValue: 'Jalandhar',
                stateField: 'state',
                stateValue: 'Punjab',
                wardIdField: 'ward_id',
            },
            expectedFeatureCount: 3,
        })),
        /Duplicate ward ID/,
    );
});

test('invalid topology, unsupported CRS, and missing licenses are rejected', () => {
    const selfIntersecting = {
        ...jalandharCity,
        geometry: {
            type: 'Polygon',
            coordinates: [[
                [75.56, 31.32], [75.58, 31.35], [75.58, 31.32], [75.56, 31.35], [75.56, 31.32],
            ]],
        },
    };
    assert.throws(
        () => normalizeCityBoundarySource('jalandhar', selfIntersecting, makeManifest()),
        /invalid polygon topology/,
    );
    assert.throws(
        () => normalizeCityBoundarySource('jalandhar', jalandharCity, makeManifest({ crs: 'EPSG:32643' })),
        /Unsupported boundary CRS/,
    );
    assert.throws(
        () => normalizeCityBoundarySource('jalandhar', jalandharCity, makeManifest({ license: 'unknown' })),
        /license must be identified/,
    );
});

test('source precedence prevents unverified fallback and duplicate replacement', () => {
    const osm = { osmBoundaryId: '21180767' };
    const wards = {
        boundaryMetadata: { sourceType: 'official-wards', sourceId: 'wards-1' },
    };
    const prototypeMetadata = { sourceType: 'prototype-study-area', sourceId: 'study-1' };
    const wardsMetadata = { sourceType: 'official-wards', sourceId: 'wards-2' };

    assert.equal(canReplaceBoundary(osm, prototypeMetadata).allowed, false);
    assert.equal(canReplaceBoundary(wards, prototypeMetadata).allowed, false);
    assert.equal(canReplaceBoundary(wards, wardsMetadata).allowed, false);
    assert.equal(canReplaceBoundary(wards, wardsMetadata, { replace: true }).allowed, true);
    assert.equal(canReplaceBoundary(null, prototypeMetadata).allowed, true);
    assert.equal(canReplaceBoundary(wards, {
        sourceType: 'official-wards',
        sourceId: 'wards-1',
    }).allowed, true);
});

test('re-importing one source updates its city record instead of creating duplicates', async () => {
    const stored = new Map();
    let upsertCalls = 0;
    const cityModel = {
        findOne: ({ cityId }) => ({
            select: () => ({
                lean: async () => stored.get(cityId) || null,
            }),
        }),
        updateOne: async ({ cityId }, update, options) => {
            assert.equal(options.upsert, true);
            stored.set(cityId, update.$set);
            upsertCalls += 1;
        },
    };
    const normalized = normalizeCityBoundarySource('jalandhar', jalandharCity, makeManifest());

    await persistCityBoundary(normalized, { cityModel });
    await persistCityBoundary(normalized, { cityModel });

    assert.equal(stored.size, 1);
    assert.equal(stored.get('jalandhar').boundaryMetadata.sourceId, 'jalandhar-mc-boundary-2026');
    assert.equal(upsertCalls, 2);
});
