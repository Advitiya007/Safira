import { SUPPORTED_CITIES } from '../config/safeRouteConfig.js';
import {
    getCityCoverage,
    getNearbyCityFeatures,
    getSupportedCities,
    getCityForPoint,
} from '../services/geographicDataService.js';
import { analyzeSafeRoutes, getSafeRouteAnalysis } from '../services/safeRouteService.js';
import { geocodeLocation } from '../services/geocodingService.js';

const sendError = (res, error) => res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Safe route request failed',
});

export const listCities = async (req, res) => {
    try {
        const cities = await getSupportedCities();
        return res.status(200).json({ success: true, data: cities });
    } catch (error) {
        return sendError(res, error);
    }
};

export const geocode = async (req, res) => {
    try {
        const result = await geocodeLocation(req.query.q);
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        return sendError(res, error);
    }
};

export const getCityCoverageDetails = async (req, res) => {
    try {
        if (!SUPPORTED_CITIES.some((city) => city.id === req.params.cityId)) {
            return res.status(404).json({ success: false, message: 'Supported city not found' });
        }
        const coverage = await getCityCoverage(req.params.cityId);
        return res.status(200).json({
            success: true,
            data: coverage || {
                cityId: req.params.cityId,
                available: false,
                featureCount: 0,
                coverage: {},
                featureImportStatus: 'pending',
                message: 'No geographic coverage is configured for this city',
            },
        });
    } catch (error) {
        return sendError(res, error);
    }
};

export const locateCity = async (req, res) => {
    try {
        const latitude = Number(req.query.latitude);
        const longitude = Number(req.query.longitude);
        if (
            !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
            !Number.isFinite(longitude) || longitude < -180 || longitude > 180
        ) {
            return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required' });
        }
        const city = await getCityForPoint(latitude, longitude);
        return res.status(200).json({ success: true, data: { cityId: city?.cityId || null } });
    } catch (error) {
        return sendError(res, error);
    }
};

export const getNearbyPlaces = async (req, res) => {
    try {
        const { cityId, latitude, longitude, radius = '250', limit = '100' } = req.query;
        const lat = Number(latitude);
        const lon = Number(longitude);
        const distance = Number(radius);
        const resultLimit = Number(limit);
        if (
            !SUPPORTED_CITIES.some((city) => city.id === cityId) ||
            !Number.isFinite(lat) || lat < -90 || lat > 90 ||
            !Number.isFinite(lon) || lon < -180 || lon > 180 ||
            !Number.isInteger(distance) || distance < 25 || distance > 1000 ||
            !Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > 200
        ) {
            return res.status(400).json({ success: false, message: 'Invalid city or nearby-place query parameters' });
        }
        const places = await getNearbyCityFeatures(cityId, lat, lon, distance, resultLimit);
        return res.status(200).json({ success: true, data: places });
    } catch (error) {
        return sendError(res, error);
    }
};

export const analyzeRoutes = async (req, res) => {
    try {
        const { cityId, origin, destination, mode, departureTime } = req.body || {};
        if (!SUPPORTED_CITIES.some((city) => city.id === cityId)) {
            return res.status(400).json({ success: false, message: 'Choose Jalandhar, Bathinda, or Delhi' });
        }
        const result = await analyzeSafeRoutes({
            userId: req.user.userId,
            cityId,
            origin,
            destination,
            mode,
            departureTime,
            signal: req.routeAbortController.signal,
        });
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        return sendError(res, error);
    }
};

export const getRouteAnalysis = async (req, res) => {
    try {
        const analysis = await getSafeRouteAnalysis(req.params.id, req.user.userId);
        return res.status(200).json({ success: true, data: analysis });
    } catch (error) {
        return sendError(res, error);
    }
};

export const getRouteAnalysisDetails = async (req, res) => {
    try {
        const analysis = await getSafeRouteAnalysis(req.params.id, req.user.userId);
        return res.status(200).json({
            success: true,
            data: {
                analysisId: analysis._id,
                cityId: analysis.cityId,
                mode: analysis.mode,
                scoringWeights: analysis.scoringWeights,
                departureTime: analysis.departureTime,
                osmDataTimestamp: analysis.osmDataTimestamp,
                dataCoverage: analysis.dataCoverage,
                routes: analysis.routes,
                recommendedRouteIndex: analysis.recommendedRouteIndex,
            },
        });
    } catch (error) {
        return sendError(res, error);
    }
};
