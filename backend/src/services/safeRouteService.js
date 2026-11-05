import mongoose from 'mongoose';
import {
    MAX_ROUTE_DISTANCE_METERS,
    ROUTE_MODES,
    ROUTE_SCORING_VERSION,
    CITY_BOUNDING_BOXES,
    EMERGENCY_FACILITY_SEARCH_RADIUS_METERS,
} from '../config/safeRouteConfig.js';
import RouteAnalysis from '../models/RouteAnalysis.js';
import {
    findFeaturesNearSegments,
    getCityById,
    getCityCoverage,
} from './geographicDataService.js';
import { isPointWithinCityBounds } from './osmBoundingBoxImportService.js';
import { generateRouteAlternatives } from './routeEngineService.js';
import { segmentRoute } from './routeSegmentationService.js';
import { scoreRouteSegments } from './routeScoringService.js';
import { recommendRoute } from './routeRecommendationService.js';

const createError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const validatePoint = (point, label) => {
    if (
        !point ||
        !Number.isFinite(point.latitude) ||
        !Number.isFinite(point.longitude) ||
        point.latitude < -90 ||
        point.latitude > 90 ||
        point.longitude < -180 ||
        point.longitude > 180
    ) {
        throw createError(`${label} must contain valid latitude and longitude coordinates`, 400);
    }
};

export const isRouteInsideCityCoverage = (route, cityId) => {
    if (!Array.isArray(route.coordinates) || route.coordinates.length < 2) return false;
    return route.coordinates.every((point) => (
        Array.isArray(point) && point.length >= 2 &&
        isPointWithinCityBounds(cityId, point[0], point[1])
    ));
};

export const analyzeSafeRoutes = async ({ userId, cityId, origin, destination, mode, departureTime, signal }) => {
    validatePoint(origin, 'Origin');
    validatePoint(destination, 'Destination');
    if (!Object.hasOwn(ROUTE_MODES, mode)) {
        throw createError('Travel mode must be walking or driving', 400);
    }

    const departure = new Date(departureTime);
    if (!Number.isFinite(departure.getTime())) throw createError('A valid departure time is required', 400);

    if (!Object.hasOwn(CITY_BOUNDING_BOXES, cityId)) {
        throw createError('Choose Jalandhar, Bathinda, or Delhi', 400);
    }
    const [city, coverage] = await Promise.all([
        getCityById(cityId),
        getCityCoverage(cityId),
    ]);
    if (!coverage?.available || !city) {
        throw createError(
            `Geographic feature data is not available for ${coverage?.name || cityId}; import OSM features for its configured coverage first`,
            503,
        );
    }
    if (!isPointWithinCityBounds(cityId, origin.latitude, origin.longitude)) {
        throw createError('Starting location is outside the selected city geographic coverage', 400);
    }
    if (!isPointWithinCityBounds(cityId, destination.latitude, destination.longitude)) {
        throw createError('Destination is outside the selected city geographic coverage', 400);
    }

    let alternatives;
    try {
        alternatives = await generateRouteAlternatives({ origin, destination, mode, signal });
    } catch (error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
        throw createError(error.message || 'Routing service is unavailable', 502);
    }
    const validAlternatives = alternatives
        .filter((route) => route.distanceMeters <= MAX_ROUTE_DISTANCE_METERS)
        .filter((route) => isRouteInsideCityCoverage(route, cityId));
    if (!validAlternatives.length) {
        throw createError('No route alternatives were available within the selected city geographic coverage', 422);
    }

    let routesWithSegments;
    try {
        routesWithSegments = validAlternatives.map((route) => ({
            ...route,
            segments: segmentRoute(
                route.coordinates,
                route.durationSeconds,
                departure,
                ROUTE_MODES[mode].segmentLengthMeters,
            ),
        }));
    } catch (error) {
        throw createError(`Routing service returned invalid route geometry: ${error.message}`, 502);
    }
    const allSegments = routesWithSegments.flatMap((route) => route.segments);
    const featureQuery = city.dataImportedAt
        ? await findFeaturesNearSegments(
            cityId,
            allSegments,
            Math.max(
                ROUTE_MODES[mode].searchRadiusMeters,
                EMERGENCY_FACILITY_SEARCH_RADIUS_METERS,
            ),
        )
        : { features: [], truncated: false };
    const { features, truncated: featureQueryTruncated } = featureQuery;
    const dataCoverage = { ...coverage, featureQueryTruncated };

    const scoredRoutes = routesWithSegments.map((route) => {
        const analysis = scoreRouteSegments(route.segments, features, {
            mode,
            timezone: city.timezone,
            searchRadiusMeters: ROUTE_MODES[mode].searchRadiusMeters,
            emergencySearchRadiusMeters: EMERGENCY_FACILITY_SEARCH_RADIUS_METERS,
            osmDataTimestamp: city.osmDataTimestamp,
            featureQueryTruncated,
        });
        return {
            id: route.id,
            coordinates: route.coordinates,
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            score: analysis.score,
            confidence: analysis.confidence,
            scoredSegmentCoveragePercent: analysis.scoredSegmentCoveragePercent,
            longestMappedActivityGapMeters: analysis.longestMappedActivityGapMeters,
            mappedFeatureCount: analysis.mappedFeatureCount,
            indicators: analysis.indicators,
            indicatorCoverage: analysis.indicatorCoverage,
            emergencyFacilityCount: analysis.emergencyFacilityCount,
            nearestEmergencyFacilityMeters: analysis.nearestEmergencyFacilityMeters,
            facilities: analysis.facilities,
            explanations: analysis.explanations,
            segments: analysis.segments,
        };
    });

    const recommendation = recommendRoute(scoredRoutes);
    const recommendedRouteIndex = recommendation.recommendedRouteIndex;
    const routesWithRankingReasons = scoredRoutes.map((route, index) => ({
        ...route,
        rankingReason: recommendation.rankingReasons[index],
    }));
    const analysisRecord = await RouteAnalysis.create({
        userId: new mongoose.Types.ObjectId(userId),
        cityId,
        mode,
        scoringWeights: ROUTE_MODES[mode].weights,
        departureTime: departure,
        origin: { type: 'Point', coordinates: [origin.longitude, origin.latitude] },
        destination: { type: 'Point', coordinates: [destination.longitude, destination.latitude] },
        routes: routesWithRankingReasons.map((route) => ({
            id: route.id,
            geometry: {
                type: 'LineString',
                coordinates: route.coordinates.map(([latitude, longitude]) => [longitude, latitude]),
            },
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            score: route.score,
            confidence: route.confidence,
            scoredSegmentCoveragePercent: route.scoredSegmentCoveragePercent,
            longestMappedActivityGapMeters: route.longestMappedActivityGapMeters,
            mappedFeatureCount: route.mappedFeatureCount,
            indicators: route.indicators,
            indicatorCoverage: route.indicatorCoverage,
            emergencyFacilityCount: route.emergencyFacilityCount,
            nearestEmergencyFacilityMeters: route.nearestEmergencyFacilityMeters,
            explanations: route.explanations,
            rankingReason: route.rankingReason,
            facilities: route.facilities,
            segments: route.segments,
        })),
        recommendedRouteIndex,
        recommendationStatus: recommendation.recommendationStatus,
        recommendationMessage: recommendation.recommendationMessage,
        minimumRecommendationConfidence: recommendation.minimumConfidence,
        algorithmVersion: ROUTE_SCORING_VERSION,
        osmDataTimestamp: city.osmDataTimestamp || null,
        dataCoverage,
    });

    return {
        analysisId: analysisRecord._id,
        city: { cityId: city.cityId, name: city.name, boundarySource: city.boundarySource },
        mode,
        scoringWeights: ROUTE_MODES[mode].weights,
        departureTime: departure,
        osmDataTimestamp: city.osmDataTimestamp || null,
        dataCoverage,
        routes: routesWithRankingReasons,
        recommendedRouteIndex,
        recommendationStatus: recommendation.recommendationStatus,
        recommendationMessage: recommendation.recommendationMessage,
        minimumRecommendationConfidence: recommendation.minimumConfidence,
    };
};

export const getSafeRouteAnalysis = async (analysisId, userId) => {
    if (!mongoose.Types.ObjectId.isValid(analysisId)) throw createError('Invalid route analysis ID', 400);
    const analysis = await RouteAnalysis.findOne({ _id: analysisId, userId }).lean();
    if (!analysis) throw createError('Route analysis not found', 404);
    return {
        ...analysis,
        routes: analysis.routes.map((route, index) => ({
            id: route.id ?? index,
            coordinates: route.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]),
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            score: route.score,
            confidence: route.confidence,
            scoredSegmentCoveragePercent: route.scoredSegmentCoveragePercent,
            longestMappedActivityGapMeters: route.longestMappedActivityGapMeters,
            mappedFeatureCount: route.mappedFeatureCount,
            indicators: route.indicators,
            indicatorCoverage: route.indicatorCoverage,
            emergencyFacilityCount: route.emergencyFacilityCount,
            nearestEmergencyFacilityMeters: route.nearestEmergencyFacilityMeters,
            explanations: route.explanations,
            facilities: route.facilities,
            segments: route.segments,
            rankingReason: route.rankingReason,
        })),
    };
};
