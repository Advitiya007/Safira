import {
    ML_MAX_COORDINATES_PER_ROUTE,
    ML_MAX_ROUTES_PER_REQUEST,
    ML_PROFILE_CACHE_TTL_MS,
    getMlServiceSettings,
} from '../config/mlServiceConfig.js';
import RoadSegmentFeature from '../models/RoadSegmentFeature.js';
import { getSafeRouteAnalysis } from './safeRouteService.js';

// Bridge between Express and the Python infrastructure-clustering service.
//
// Design rules (see project.md):
//  * Additive and read-only: nothing here changes route scoring, ranking, confidence or
//    the RouteAnalysis document. Cluster information is displayed next to the indicators.
//  * Fails soft: if the ML service is not configured, down, or has no trained model, callers get
//    `{ available: false, reason }` instead of an exception, so Safe Route keeps working.
//  * The ML API key is only ever sent as a request header; it is never returned or logged.

export const UNAVAILABLE_MESSAGES = {
    not_configured: 'Infrastructure profiling is not configured on this server.',
    service_unavailable: 'The infrastructure profiling service could not be reached.',
    service_misconfigured: 'The infrastructure profiling service rejected this server\'s credentials.',
    model_not_trained: 'No infrastructure clustering model has been trained yet.',
    no_routes: 'This analysis has no route geometry to profile.',
    request_rejected: 'The infrastructure profiling service could not profile this route.',
};

const unavailable = (reason, extra = {}) => ({
    available: false,
    reason,
    message: UNAVAILABLE_MESSAGES[reason],
    ...extra,
});

// Keep the first and last point and an even subset of the rest so very long Valhalla shapes
// stay under the ML service's request limit without changing the route's overall course.
export const thinCoordinates = (coordinates, maxPoints = ML_MAX_COORDINATES_PER_ROUTE) => {
    if (coordinates.length <= maxPoints) return coordinates;
    const result = [];
    const step = (coordinates.length - 1) / (maxPoints - 1);
    for (let index = 0; index < maxPoints - 1; index += 1) {
        result.push(coordinates[Math.round(index * step)]);
    }
    result.push(coordinates[coordinates.length - 1]);
    return result;
};

// RouteAnalysis API shape is [latitude, longitude]; the ML service expects GeoJSON [lon, lat].
export const toLonLat = (coordinates) => coordinates
    .filter((point) => (
        Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
    ))
    .map(([latitude, longitude]) => [longitude, latitude]);

export const createInfrastructureService = ({
    fetchImpl = globalThis.fetch,
    getSettings = getMlServiceSettings,
    getAnalysis = getSafeRouteAnalysis,
    SegmentModel = RoadSegmentFeature,
    now = () => Date.now(),
} = {}) => {
    let profileCache = null; // { key, expiresAt, value }

    // Returns { ok: true, data } or { ok: false, reason }. Never throws for transport problems.
    const mlRequest = async (settings, path, { method = 'GET', body } = {}) => {
        let response;
        try {
            response = await fetchImpl(`${settings.baseUrl}${path}`, {
                method,
                headers: {
                    accept: 'application/json',
                    'x-api-key': settings.apiKey,
                    ...(body ? { 'content-type': 'application/json' } : {}),
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(settings.timeoutMs),
            });
        } catch (error) {
            console.warn(`ML service request failed (${method} ${path}): ${error.name}`);
            return { ok: false, reason: 'service_unavailable' };
        }
        if (response.ok) {
            try {
                return { ok: true, data: await response.json() };
            } catch {
                return { ok: false, reason: 'service_unavailable' };
            }
        }
        if (response.status === 404) return { ok: false, reason: 'model_not_trained' };
        if (response.status === 401 || response.status === 503) {
            console.warn(`ML service refused request (${method} ${path}): HTTP ${response.status}`);
            return { ok: false, reason: 'service_misconfigured' };
        }
        if (response.status === 422) return { ok: false, reason: 'request_rejected' };
        console.warn(`ML service error (${method} ${path}): HTTP ${response.status}`);
        return { ok: false, reason: 'service_unavailable' };
    };

    const loadProfiles = async (settings) => {
        const key = `${settings.baseUrl}|${settings.modelScope}`;
        if (profileCache?.key === key && profileCache.expiresAt > now()) {
            return { ok: true, data: profileCache.value };
        }
        const result = await mlRequest(
            settings,
            `/v1/model/profiles?scope=${encodeURIComponent(settings.modelScope)}`,
        );
        if (result.ok) {
            profileCache = { key, expiresAt: now() + ML_PROFILE_CACHE_TTL_MS, value: result.data };
        }
        return result;
    };

    const getSegmentCoverage = async () => {
        try {
            const rows = await SegmentModel.aggregate([
                {
                    $group: {
                        _id: '$cityId',
                        segments: { $sum: 1 },
                        assigned: { $sum: { $cond: [{ $ifNull: ['$modelAssignment', false] }, 1, 0] } },
                    },
                },
            ]);
            return Object.fromEntries(rows.map(({ _id, segments, assigned }) => [_id, { segments, assigned }]));
        } catch (error) {
            console.warn(`RoadSegmentFeature coverage lookup failed: ${error.message}`);
            return null;
        }
    };

    // Public, read-only model description for the UI legend.
    const getModelSummary = async () => {
        const settings = getSettings();
        if (!settings.enabled) return unavailable('not_configured');
        const result = await loadProfiles(settings);
        if (!result.ok) return unavailable(result.reason);
        const profiles = result.data;
        return {
            available: true,
            modelVersion: profiles.modelVersion,
            scope: profiles.scope,
            createdAt: profiles.createdAt,
            clusters: profiles.clusters,
            featuresUsed: profiles.featuresUsed,
            featureInfo: profiles.featureInfo,
            droppedFeatures: profiles.droppedFeatures,
            metrics: profiles.metrics,
            segmentCoverage: await getSegmentCoverage(),
            disclaimer: profiles.disclaimer,
        };
    };

    // Profile the routes stored in one of the signed-in user's analyses.
    const getRouteInfrastructure = async (analysisId, userId) => {
        // Ownership + validity are enforced by the existing analysis lookup (throws 400/404).
        const analysis = await getAnalysis(analysisId, userId);
        const settings = getSettings();
        if (!settings.enabled) return unavailable('not_configured', { analysisId });

        const routes = (analysis.routes || [])
            .slice(0, ML_MAX_ROUTES_PER_REQUEST)
            .map((route, index) => ({
                id: route.id ?? index,
                coordinates: thinCoordinates(toLonLat(route.coordinates || [])),
            }))
            .filter((route) => route.coordinates.length >= 2);
        if (!routes.length) return unavailable('no_routes', { analysisId });

        const [profile, profiles] = await Promise.all([
            mlRequest(settings, '/v1/routes/profile', {
                method: 'POST',
                body: { cityId: analysis.cityId, scope: settings.modelScope, routes },
            }),
            loadProfiles(settings),
        ]);
        if (!profile.ok) return unavailable(profile.reason, { analysisId });

        const clusters = Object.fromEntries((profiles.ok ? profiles.data.clusters : []).map((cluster) => [
            cluster.clusterId,
            {
                clusterId: cluster.clusterId,
                name: cluster.name,
                level: cluster.level,
                description: cluster.description,
                share: cluster.share,
            },
        ]));
        return {
            available: true,
            analysisId,
            cityId: analysis.cityId,
            modelVersion: profile.data.modelVersion,
            scope: profile.data.scope,
            routes: profile.data.routes,
            clusters,
            disclaimer: profile.data.disclaimer,
        };
    };

    return { getModelSummary, getRouteInfrastructure };
};

const defaultService = createInfrastructureService();
export const getModelSummary = (...args) => defaultService.getModelSummary(...args);
export const getRouteInfrastructure = (...args) => defaultService.getRouteInfrastructure(...args);
