// Settings for the optional Python infrastructure-clustering service (ml_service/).
// The integration is strictly additive: when these variables are not set the Safe Route
// feature behaves exactly as before and the UI simply shows no infrastructure profile.

export const ML_DEFAULT_TIMEOUT_MS = 15000;
export const ML_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
// Mirrors limits enforced by the FastAPI request models (RouteProfileRequest / RouteInput).
export const ML_MAX_ROUTES_PER_REQUEST = 5;
export const ML_MAX_COORDINATES_PER_ROUTE = 30000;
// Which trained model to use: 'global' (cross-city) or a city id.
export const ML_DEFAULT_MODEL_SCOPE = 'global';

export const getMlServiceSettings = (env = process.env) => {
    const rawUrl = String(env.ML_SERVICE_URL || '').trim();
    const apiKey = String(env.ML_SERVICE_API_KEY || '').trim();
    const timeout = Number(env.ML_SERVICE_TIMEOUT_MS);
    let baseUrl = null;
    if (rawUrl) {
        try {
            const parsed = new URL(rawUrl);
            if (['http:', 'https:'].includes(parsed.protocol)) {
                baseUrl = parsed.toString().replace(/\/+$/, '');
            }
        } catch {
            baseUrl = null;
        }
    }
    return {
        baseUrl,
        apiKey,
        enabled: Boolean(baseUrl && apiKey),
        timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : ML_DEFAULT_TIMEOUT_MS,
        modelScope: String(env.ML_MODEL_SCOPE || ML_DEFAULT_MODEL_SCOPE).trim() || ML_DEFAULT_MODEL_SCOPE,
    };
};
