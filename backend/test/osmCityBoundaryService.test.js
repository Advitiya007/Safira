import assert from 'node:assert/strict';
import test from 'node:test';
import { OSM_CITY_BOUNDARY_SEARCH_NAMES, SUPPORTED_CITIES } from '../src/config/safeRouteConfig.js';
import {
    findOsmCityBoundary,
    isCityBoundaryCandidate,
    isValidBoundaryGeometry,
    seedOsmCityBoundaries,
} from '../src/services/osmCityBoundaryService.js';

const makePolygon = () => ({
    type: 'Polygon',
    coordinates: [
        [[75, 30], [76, 30], [76, 31], [75, 31], [75, 30]],
        [[75.2, 30.2], [75.4, 30.2], [75.4, 30.4], [75.2, 30.4], [75.2, 30.2]],
    ],
});

const makeBoundary = (city, overrides = {}) => ({
    category: 'boundary',
    type: 'administrative',
    osm_type: 'relation',
    osm_id: '100',
    name: city.name,
    addresstype: 'city',
    address: { city: city.name, state: city.state, country: city.country },
    extratags: { admin_level: '8' },
    geojson: makePolygon(),
    ...overrides,
});

const jsonResponse = (data) => ({
    ok: true,
    json: async () => data,
});

const responseForCity = (city, query) => {
    const url = new URL(query);
    if (url.pathname.startsWith('/api/0.6/')) {
        return jsonResponse({
            elements: [{
                type: 'relation',
                id: '21180767',
                tags: {
                    name: 'Delhi',
                    boundary: 'administrative',
                    type: 'boundary',
                    admin_level: '8',
                },
            }],
        });
    }
    if (url.pathname.endsWith('/lookup')) {
        return jsonResponse([makeBoundary(SUPPORTED_CITIES[2], {
            osm_id: '21180767',
            address: {
                city: 'Delhi',
                state_district: 'Old Delhi',
                state: 'Delhi',
                country: 'India',
            },
        })]);
    }

    const name = url.searchParams.get('q').split(',')[0];
    if (city.id === 'delhi' && name === 'Delhi') {
        return jsonResponse([
            makeBoundary(city, {
                osm_id: '21180767',
                address: {
                    city: 'Delhi',
                    state_district: 'Old Delhi',
                    state: 'Delhi',
                    country: 'India',
                },
            }),
        ]);
    }

    if (city.id === 'jalandhar' && name === 'Jalandhar') {
        return jsonResponse([
            makeBoundary(city, {
                osm_id: '1948563',
                addresstype: 'state_district',
                address: { state_district: 'Jalandhar', state: 'Punjab', country: 'India' },
                extratags: { admin_level: '5' },
            }),
            { osm_type: 'node', osm_id: '559844882', category: 'place', type: 'city', name: 'Jalandhar' },
        ]);
    }

    if (city.id === 'bathinda' && name === 'Bathinda') {
        return jsonResponse([
            makeBoundary(city, {
                osm_id: '1948503',
                addresstype: 'state_district',
                address: { state_district: 'Bathinda', state: 'Punjab', country: 'India' },
                extratags: { admin_level: '5' },
            }),
            { osm_type: 'node', osm_id: '1396981980', category: 'place', type: 'city', name: 'Bathinda' },
        ]);
    }
    return jsonResponse([]);
};

test('boundary seeding stores only Delhi city relation, rejects district boundaries, and preserves holes', async () => {
    const stored = new Map();
    const log = { info: [], warn: [], error: [] };
    const logger = Object.fromEntries(
        Object.keys(log).map((level) => [level, (message) => log[level].push(message)]),
    );
    const cities = SUPPORTED_CITIES;
    const saveBoundary = async (city, boundary) => stored.set(city.id, boundary);
    const seed = () => seedOsmCityBoundaries({
        cities,
        fetcher: async (url) => {
            const query = new URL(url);
            const searchName = query.searchParams.get('q')?.split(',')[0];
            const city = cities.find((item) => OSM_CITY_BOUNDARY_SEARCH_NAMES[item.id].includes(searchName));
            return responseForCity(city, url);
        },
        saveBoundary,
        logger,
        delayMs: 0,
        retrievedAt: () => new Date('2026-03-01T00:00:00.000Z'),
    });

    const firstRun = await seed();
    const secondRun = await seed();

    assert.deepEqual(firstRun.map(({ cityId, status }) => [cityId, status]), [
        ['jalandhar', 'not_found'],
        ['bathinda', 'not_found'],
        ['delhi', 'stored'],
    ]);
    assert.deepEqual(secondRun.map(({ status }) => status), ['not_found', 'not_found', 'stored']);
    assert.deepEqual([...stored.keys()], ['delhi']);
    assert.equal(stored.get('delhi').osmId, '21180767');
    assert.equal(stored.get('delhi').adminLevel, '8');
    assert.equal(stored.get('delhi').geometry.coordinates.length, 2);
    assert.equal(stored.get('delhi').retrievedAt.toISOString(), '2026-03-01T00:00:00.000Z');
    assert.equal(log.warn.length, 4);
    assert.ok(log.warn.every((message) => message.includes('district boundaries were excluded')));
});

test('alternate city names are accepted without assuming a shared administrative level', async () => {
    const city = SUPPORTED_CITIES.find(({ id }) => id === 'jalandhar');
    const boundary = makeBoundary(city, {
        osm_id: '9001',
        name: 'Jullundur',
        extratags: { admin_level: '7' },
    });
    const result = await findOsmCityBoundary({
        city,
        fetcher: async (url) => {
            const query = new URL(url);
            if (query.pathname.startsWith('/api/0.6/')) {
                return jsonResponse({
                    elements: [{
                        type: 'relation',
                        id: '9001',
                        tags: {
                            name: 'Jullundur',
                            boundary: 'administrative',
                            type: 'multipolygon',
                            admin_level: '7',
                        },
                    }],
                });
            }
            if (query.pathname.endsWith('/lookup')) return jsonResponse([boundary]);
            return jsonResponse(query.searchParams.get('q').startsWith('Jullundur') ? [boundary] : []);
        },
    });

    assert.equal(result.status, 'found');
    assert.equal(result.candidate.name, 'Jullundur');
    assert.equal(result.candidate.extratags.admin_level, '7');
    assert.equal(isCityBoundaryCandidate(result.candidate, city), true);
    assert.deepEqual(OSM_CITY_BOUNDARY_SEARCH_NAMES.jalandhar, ['Jalandhar', 'Jullundur', 'ਜਲੰਧਰ']);
});

test('invalid geometry and failed downloads are classified distinctly', async () => {
    const city = SUPPORTED_CITIES.find(({ id }) => id === 'bathinda');
    const invalidBoundary = makeBoundary(city, {
        name: 'Bhatinda',
        geojson: { type: 'Polygon', coordinates: [[[74, 30], [75, 30], [75, 31], [74, 31]]] },
    });
    const invalid = await findOsmCityBoundary({
        city,
        fetcher: async (url) => {
            const query = new URL(url);
            return query.pathname.endsWith('/lookup')
                ? jsonResponse([invalidBoundary])
                : jsonResponse(query.searchParams.get('q').startsWith('Bhatinda') ? [invalidBoundary] : []);
        },
    });
    const failed = await findOsmCityBoundary({
        city,
        fetcher: async () => { throw new Error('network unavailable'); },
    });

    assert.equal(isValidBoundaryGeometry(invalidBoundary.geojson), false);
    assert.equal(invalid.status, 'invalid');
    assert.equal(failed.status, 'download_failed');
});

test('a closed administrative boundary way is accepted after its OSM tags are verified', async () => {
    const city = SUPPORTED_CITIES.find(({ id }) => id === 'bathinda');
    const boundary = makeBoundary(city, {
        osm_type: 'way',
        osm_id: '9002',
        name: 'Bhatinda',
        extratags: { admin_level: '6' },
    });
    const result = await findOsmCityBoundary({
        city,
        fetcher: async (url) => {
            const query = new URL(url);
            if (query.pathname.startsWith('/api/0.6/')) {
                return jsonResponse({
                    elements: [{
                        type: 'way',
                        id: '9002',
                        nodes: [1, 2, 3, 1],
                        tags: { name: 'Bhatinda', boundary: 'administrative', admin_level: '6' },
                    }],
                });
            }
            if (query.pathname.endsWith('/lookup')) return jsonResponse([boundary]);
            return jsonResponse(query.searchParams.get('q').startsWith('Bhatinda') ? [boundary] : []);
        },
    });

    assert.equal(result.status, 'found');
    assert.equal(result.candidate.osm_type, 'way');
    assert.equal(result.candidate.osmTags.admin_level, '6');
});

test('database save failures are logged and surfaced in the seeding outcome', async () => {
    const city = SUPPORTED_CITIES.find(({ id }) => id === 'delhi');
    const errors = [];
    const outcome = await seedOsmCityBoundaries({
        cities: [city],
        fetcher: async (url) => responseForCity(city, url),
        saveBoundary: async () => { throw new Error('database unavailable'); },
        logger: { info: () => {}, warn: () => {}, error: (message) => errors.push(message) },
        delayMs: 0,
    });

    assert.deepEqual(outcome, [{ cityId: 'delhi', status: 'save_failed' }]);
    assert.match(errors[0], /Failed to save OSM boundary for Delhi/);
    assert.match(errors[0], /database unavailable/);
});
