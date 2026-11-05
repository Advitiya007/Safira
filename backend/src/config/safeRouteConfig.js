export const SUPPORTED_CITIES = [
    { id: 'jalandhar', name: 'Jalandhar', state: 'Punjab', country: 'India', timezone: 'Asia/Kolkata' },
    { id: 'bathinda', name: 'Bathinda', state: 'Punjab', country: 'India', timezone: 'Asia/Kolkata' },
    { id: 'delhi', name: 'Delhi', state: 'Delhi', country: 'India', timezone: 'Asia/Kolkata' },
];

export const CITY_BOUNDING_BOXES = {
    jalandhar: { south: 31.25, west: 75.47, north: 31.42, east: 75.67 },
    bathinda: { south: 30.11, west: 74.83, north: 30.31, east: 75.05 },
    delhi: { south: 28.40, west: 76.84, north: 28.88, east: 77.35 },
};

export const OSM_CITY_BOUNDARY_SEARCH_NAMES = {
    jalandhar: ['Jalandhar', 'Jullundur', 'ਜਲੰਧਰ'],
    bathinda: ['Bathinda', 'Bhatinda', 'ਬਠਿੰਡਾ'],
    delhi: ['Delhi'],
};

export const CITY_BOUNDARY_IDENTITY_NAMES = {
    jalandhar: ['Jalandhar', 'Jullundur'],
    bathinda: ['Bathinda', 'Bhatinda'],
    delhi: ['Delhi'],
};

export const CITY_BOUNDARY_REFERENCE_POINTS = {
    jalandhar: [75.576889, 31.3323762],
    bathinda: [74.9463699, 30.206791],
    delhi: [77.2197713, 28.6328027],
};

export const CITY_BOUNDARY_SOURCE_PRIORITY = {
    osm: 0,
    'official-municipal': 1,
    'official-wards': 2,
    'other-administrative': 3,
    'prototype-study-area': 4,
};

export const ROUTE_MODES = {
    walking: {
        valhallaCosting: 'pedestrian',
        segmentLengthMeters: 150,
        searchRadiusMeters: 125,
        weights: {
            nightActivity: 0.25,
            lighting: 0.20,
            roadAccessibility: 0.10,
            cctv: 0.10,
            emergencyAccess: 0.15,
            publicTransport: 0.05,
            isolation: 0.15,
        },
    },
    driving: {
        valhallaCosting: 'auto',
        segmentLengthMeters: 200,
        searchRadiusMeters: 200,
        weights: {
            nightActivity: 0.15,
            lighting: 0.15,
            roadAccessibility: 0.20,
            cctv: 0.10,
            emergencyAccess: 0.15,
            publicTransport: 0.10,
            isolation: 0.15,
        },
    },
};

export const ROUTE_SCORING_VERSION = 2;
export const MINIMUM_RECOMMENDATION_CONFIDENCE = 35;
export const EMERGENCY_FACILITY_SEARCH_RADIUS_METERS = 1000;
export const ROUTE_ALTERNATIVE_COUNT = 2;
export const MAX_ROUTE_DISTANCE_METERS = 100000;
export const ROUTE_ANALYSIS_TTL_SECONDS = 24 * 60 * 60;
