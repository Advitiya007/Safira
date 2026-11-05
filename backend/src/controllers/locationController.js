import { fetchNearbyPlaces } from '../services/geographicPlaceService.js';
import { getRouteSafetyIndicators } from '../services/routeSafetyService.js';
import { logActivity } from './activityController.js';

/**
 * GET /api/locations/nearby?latitude=...&longitude=...&radius=...&type=all
 * Reads nearby facilities from the city's imported OpenStreetMap feature data.
 */
const getNearbyPlaces = async (req, res, next) => {
    try {
        const { latitude, longitude, radius = 5000, type = 'all' } = req.query;

        if (latitude === undefined || longitude === undefined) {
            res.status(400);
            throw new Error('Latitude and longitude are required');
        }

        const lat = parseFloat(latitude);
        const lon = parseFloat(longitude);
        const distance = Number(radius);

        if (
            !Number.isFinite(lat) || lat < -90 || lat > 90 ||
            !Number.isFinite(lon) || lon < -180 || lon > 180 ||
            !Number.isInteger(distance) || distance < 25 || distance > 5000
        ) {
            return res.status(400).json({
                success: false,
                message: 'Valid coordinates and a radius from 25 to 5000 metres are required',
            });
        }

        // Log activity if authenticated
        if (req.user) {
            logActivity(req.user.userId, 'map_opened', { latitude: lat, longitude: lon });
        }

        let places = await fetchNearbyPlaces(lat, lon, distance);

        // Filter by type if specified
        if (type !== 'all') {
            places = places.filter(p => p.type === type.toLowerCase());
        }

        res.status(200).json({
            success: true,
            message: `Found ${places.length} nearby places`,
            data: places,
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/locations/search?query=...&latitude=...&longitude=...
 * Searches for places by name in the nearby results.
 */
const searchPlaces = async (req, res, next) => {
    try {
        const { query, latitude, longitude, radius = 5000 } = req.query;

        if (!query) {
            res.status(400);
            throw new Error('Search query is required');
        }

        const lat = parseFloat(latitude) || 28.6139;
        const lon = parseFloat(longitude) || 77.2090;

        // Fetch places and filter by search query
        const allPlaces = await fetchNearbyPlaces(lat, lon, parseInt(radius));
        const q = query.toLowerCase();
        const places = allPlaces.filter(
            (p) => p.name.toLowerCase().includes(q) || p.type.toLowerCase().includes(q)
        );

        res.status(200).json({
            success: true,
            message: `Found ${places.length} results for "${query}"`,
            data: places,
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/locations/:id — Returns a Google Maps lookup for the persistent OSM ID.
 * Returns a helpful message.
 */
const getPlaceDetails = async (req, res, next) => {
    try {
        const { id } = req.params;

        res.status(200).json({
            success: true,
            message: 'Use Google Maps for detailed place info',
            data: {
                id,
                googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=place_id:${id}`,
            },
        });
    } catch (err) {
        next(err);
    }
};

const getRouteSafety = async (req, res, next) => {
    try {
        const { routes } = req.body;
        if (
            !Array.isArray(routes) ||
            routes.length < 1 ||
            routes.length > 3 ||
            routes.some((route) => (
                !Array.isArray(route) ||
                route.length < 2 ||
                route.length > 300 ||
                route.some((point) => (
                    !Array.isArray(point) ||
                    point.length !== 2 ||
                    !Number.isFinite(point[0]) ||
                    !Number.isFinite(point[1]) ||
                    point[0] < -90 ||
                    point[0] > 90 ||
                    point[1] < -180 ||
                    point[1] > 180
                ))
            ))
        ) {
            return res.status(400).json({
                success: false,
                message: 'Provide 1 to 3 routes with valid latitude/longitude coordinates',
            });
        }

        const data = await getRouteSafetyIndicators(routes);
        return res.status(200).json({
            success: true,
            message: 'Route indicators calculated from OpenStreetMap data',
            data,
        });
    } catch (err) {
        return next(err);
    }
};

export { getNearbyPlaces, searchPlaces, getPlaceDetails, getRouteSafety };
