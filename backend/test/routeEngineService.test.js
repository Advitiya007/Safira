import assert from 'node:assert/strict';
import test from 'node:test';
import { ROUTE_MODES, SUPPORTED_CITIES } from '../src/config/safeRouteConfig.js';
import { generateRouteAlternatives } from '../src/services/routeEngineService.js';

const encodeComponent = (value) => {
    let remaining = value < 0 ? ~(value << 1) : value << 1;
    let encoded = '';
    while (remaining >= 0x20) {
        encoded += String.fromCharCode((0x20 | (remaining & 0x1f)) + 63);
        remaining >>= 5;
    }
    return encoded + String.fromCharCode(remaining + 63);
};

const encodePolyline6 = (coordinates) => {
    let previousLatitude = 0;
    let previousLongitude = 0;
    return coordinates.map(([latitude, longitude]) => {
        const scaledLatitude = Math.round(latitude * 1e6);
        const scaledLongitude = Math.round(longitude * 1e6);
        const encoded = encodeComponent(scaledLatitude - previousLatitude) +
            encodeComponent(scaledLongitude - previousLongitude);
        previousLatitude = scaledLatitude;
        previousLongitude = scaledLongitude;
        return encoded;
    }).join('');
};

const makeTrip = (coordinates, length, time) => ({
    summary: { length, time },
    legs: [{ shape: encodePolyline6(coordinates) }],
});

test('supported city and mode configuration covers three cities and walking/driving', () => {
    assert.deepEqual(SUPPORTED_CITIES.map((city) => city.id), ['jalandhar', 'bathinda', 'delhi']);
    assert.equal(ROUTE_MODES.walking.valhallaCosting, 'pedestrian');
    assert.equal(ROUTE_MODES.driving.valhallaCosting, 'auto');
});

test('Valhalla request returns decoded alternative geometries and distances', async (context) => {
    const originalFetch = globalThis.fetch;
    context.after(() => { globalThis.fetch = originalFetch; });
    const expected = [[28.6, 77.2], [28.601, 77.201]];
    let requestBody;
    globalThis.fetch = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return {
            ok: true,
            json: async () => ({
                trip: makeTrip(expected, 1.4, 120),
                alternates: [{ trip: makeTrip([[28.6, 77.2], [28.602, 77.202]], 1.8, 160) }],
            }),
        };
    };

    for (const [mode, costing] of [['walking', 'pedestrian'], ['driving', 'auto']]) {
        const routes = await generateRouteAlternatives({
            origin: { latitude: 28.6, longitude: 77.2 },
            destination: { latitude: 28.601, longitude: 77.201 },
            mode,
        });

        assert.equal(requestBody.costing, costing);
        assert.equal(requestBody.alternates, 2);
        assert.equal(routes.length, 2);
        assert.equal(routes[0].distanceMeters, 1400);
        assert.ok(Math.abs(routes[0].coordinates[1][0] - expected[1][0]) < 0.000001);
    }
});

test('routing service failures and malformed geometry do not fabricate route alternatives', async (context) => {
    const originalFetch = globalThis.fetch;
    context.after(() => { globalThis.fetch = originalFetch; });
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(
        generateRouteAlternatives({
            origin: { latitude: 28.6, longitude: 77.2 },
            destination: { latitude: 28.601, longitude: 77.201 },
            mode: 'driving',
        }),
        /returned 503/,
    );

    globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
            trip: { summary: { length: 1, time: 60 }, legs: [{ shape: '' }] },
            alternates: [{
                trip: makeTrip([[28.6, 77.2], [28.601, 77.201]], 1.2, 90),
            }],
        }),
    });
    const usableAlternative = await generateRouteAlternatives({
        origin: { latitude: 28.6, longitude: 77.2 },
        destination: { latitude: 28.601, longitude: 77.201 },
        mode: 'driving',
    });
    assert.equal(usableAlternative.length, 1);
    assert.equal(usableAlternative[0].id, 1);

    globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({ trip: { summary: { length: 1, time: 60 }, legs: [{ shape: '' }] } }),
    });
    await assert.rejects(
        generateRouteAlternatives({
            origin: { latitude: 28.6, longitude: 77.2 },
            destination: { latitude: 28.601, longitude: 77.201 },
            mode: 'driving',
        }),
        /incomplete route geometry/,
    );
});
