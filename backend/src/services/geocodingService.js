const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const MIN_REQUEST_INTERVAL_MS = 1100;

const cache = new Map();
let requestQueue = Promise.resolve();
let lastRequestAt = 0;

const createError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

export const geocodeLocation = async (query) => {
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    if (normalizedQuery.length < 2 || normalizedQuery.length > 200) {
        throw createError('Search text must be between 2 and 200 characters', 400);
    }

    const cacheKey = normalizedQuery.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    if (cached) cache.delete(cacheKey);

    let releaseQueue;
    const previousRequest = requestQueue;
    requestQueue = new Promise((resolve) => { releaseQueue = resolve; });
    await previousRequest;
    try {
        const queuedCache = cache.get(cacheKey);
        if (queuedCache && queuedCache.expiresAt > Date.now()) return queuedCache.result;
        const waitMilliseconds = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
        if (waitMilliseconds > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitMilliseconds));
        }

        const params = new URLSearchParams({
            q: normalizedQuery,
            format: 'jsonv2',
            limit: '1',
        });
        if (process.env.NOMINATIM_EMAIL) params.set('email', process.env.NOMINATIM_EMAIL);
        lastRequestAt = Date.now();

        let response;
        try {
            response = await fetch(`${NOMINATIM_URL}?${params}`, {
                headers: { 'User-Agent': 'SafeHerIndia/1.0 (Safe Route destination search)' },
                signal: AbortSignal.timeout(15000),
            });
        } catch (error) {
            throw createError(`Address search service is unavailable: ${error.message}`, 502);
        }
        if (!response.ok) throw createError(`Address search service returned ${response.status}`, 502);

        let results;
        try {
            results = await response.json();
        } catch {
            throw createError('Address search service returned an invalid response', 502);
        }
        const [result] = Array.isArray(results) ? results : [];
        const latitude = Number(result?.lat);
        const longitude = Number(result?.lon);
        if (
            !result ||
            typeof result.display_name !== 'string' ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            throw createError('No matching destination was found', 404);
        }

        const geocoded = { name: result.display_name, lat: latitude, lon: longitude };
        cache.set(cacheKey, { result: geocoded, expiresAt: Date.now() + CACHE_TTL_MS });
        if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        return geocoded;
    } finally {
        releaseQueue();
    }
};
