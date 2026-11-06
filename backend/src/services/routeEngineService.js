import { ROUTE_ALTERNATIVE_COUNT, ROUTE_MODES } from '../config/safeRouteConfig.js';

const decodePolyline6 = (encoded) => {
    let index = 0;
    let latitude = 0;
    let longitude = 0;
    const coordinates = [];

    while (index < encoded.length) {
        const decodeValue = () => {
            let result = 0;
            let shift = 0;
            let byte;
            do {
                if (index >= encoded.length) throw new Error('Malformed Valhalla route geometry');
                byte = encoded.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);
            return result & 1 ? ~(result >> 1) : result >> 1;
        };

        latitude += decodeValue();
        longitude += decodeValue();
        coordinates.push([latitude / 1e6, longitude / 1e6]);
    }

    if (coordinates.length < 2) throw new Error('Valhalla returned incomplete route geometry');
    return coordinates;
};

const asCandidate = (trip, id) => {
    const leg = trip?.legs?.[0];
    const shape = leg?.shape;
    const distanceKilometers = trip?.summary?.length;
    const durationSeconds = trip?.summary?.time;
    if (
        typeof shape !== 'string' ||
        !Number.isFinite(distanceKilometers) ||
        distanceKilometers <= 0 ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds < 0
    ) {
        return null;
    }

    return {
        id,
        coordinates: decodePolyline6(shape),
        distanceMeters: distanceKilometers * 1000,
        durationSeconds,
    };
};

export const generateRouteAlternatives = async ({ origin, destination, mode, signal }) => {
    const modeConfig = Object.hasOwn(ROUTE_MODES, mode) ? ROUTE_MODES[mode] : null;
    if (!modeConfig) throw new Error('Travel mode must be walking or driving');

    const baseUrl = (process.env.VALHALLA_URL || 'https://valhalla1.openstreetmap.de')
        .replace(/\/+$/, '');
    const request = {
        locations: [
            { lat: origin.latitude, lon: origin.longitude },
            { lat: destination.latitude, lon: destination.longitude },
        ],
        costing: modeConfig.valhallaCosting,
        alternates: ROUTE_ALTERNATIVE_COUNT,
        units: 'kilometers',
        shape_format: 'polyline6',
        costing_options: {
            [modeConfig.valhallaCosting]: { use_ferry: 0 },
        },
    };

    let response;
    try {
        response = await fetch(`${baseUrl}/route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal: signal || AbortSignal.timeout(30000),
        });
    } catch (error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
        throw new Error(`Routing service is unavailable: ${error.message}`);
    }

    if (!response.ok) {
        throw new Error(`Routing service returned ${response.status}`);
    }
    const result = await response.json();
    const trips = [
        result.trip,
        ...(Array.isArray(result.alternates) ? result.alternates.map((alternative) => alternative.trip) : []),
    ];
    const routeErrors = [];
    const routes = trips.flatMap((trip, index) => {
        try {
            const route = asCandidate(trip, index);
            return route ? [route] : [];
        } catch (error) {
            routeErrors.push(error);
            return [];
        }
    }).slice(0, ROUTE_ALTERNATIVE_COUNT + 1);
    if (!routes.length) {
        throw new Error(
            routeErrors[0]?.message ||
            result.error ||
            result.status_message ||
            'No route alternatives are available for this mode',
        );
    }

    return routes;
};
