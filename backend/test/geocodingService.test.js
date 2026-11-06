import assert from 'node:assert/strict';
import test from 'node:test';
import { geocodeLocation } from '../src/services/geocodingService.js';

test('Nominatim lookup is identified and cached', async (context) => {
    const originalFetch = globalThis.fetch;
    context.after(() => { globalThis.fetch = originalFetch; });
    const query = `SafeHer test address ${Date.now()}`;
    let requestCount = 0;
    globalThis.fetch = async (url, options) => {
        requestCount += 1;
        assert.match(url, /format=jsonv2/);
        assert.match(options.headers['User-Agent'], /SafeHerIndia/);
        return {
            ok: true,
            json: async () => [{
                display_name: 'Test address, Delhi, India',
                lat: '28.6139',
                lon: '77.2090',
            }],
        };
    };

    const first = await geocodeLocation(query);
    const second = await geocodeLocation(query);

    assert.deepEqual(first, {
        name: 'Test address, Delhi, India',
        lat: 28.6139,
        lon: 77.209,
    });
    assert.deepEqual(second, first);
    assert.equal(requestCount, 1);
});
