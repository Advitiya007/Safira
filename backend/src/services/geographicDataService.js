import City from '../models/City.js';
import GeographicFeature from '../models/GeographicFeature.js';
import GeographicImportRun from '../models/GeographicImportRun.js';
import { CITY_BOUNDING_BOXES, SUPPORTED_CITIES } from '../config/safeRouteConfig.js';
import { isPointWithinCityBounds } from './osmBoundingBoxImportService.js';

const MAX_ROUTE_FEATURES = 15000;

export const isGeographicDataAvailable = (city) => Boolean(
    city?.dataImportedAt && Number(city.featureCount) > 0,
);

const metersPerDegree = (latitude) => ({
    latitude: 111320,
    longitude: Math.max(1000, 111320 * Math.cos(latitude * Math.PI / 180)),
});

const corridorPolygon = (start, end, radiusMeters) => {
    const scale = metersPerDegree((start[0] + end[0]) / 2);
    const startPoint = [start[1] * scale.longitude, start[0] * scale.latitude];
    const endPoint = [end[1] * scale.longitude, end[0] * scale.latitude];
    const deltaX = endPoint[0] - startPoint[0];
    const deltaY = endPoint[1] - startPoint[1];
    const length = Math.hypot(deltaX, deltaY) || 1;
    const normalX = -deltaY / length * radiusMeters;
    const normalY = deltaX / length * radiusMeters;
    const toCoordinate = ([x, y]) => [x / scale.longitude, y / scale.latitude];
    const ring = [
        toCoordinate([startPoint[0] + normalX, startPoint[1] + normalY]),
        toCoordinate([endPoint[0] + normalX, endPoint[1] + normalY]),
        toCoordinate([endPoint[0] - normalX, endPoint[1] - normalY]),
        toCoordinate([startPoint[0] - normalX, startPoint[1] - normalY]),
    ];
    ring.push(ring[0]);
    const signedArea = ring.slice(0, -1).reduce((area, point, index, points) => {
        const next = points[(index + 1) % points.length];
        return area + point[0] * next[1] - next[0] * point[1];
    }, 0);
    if (signedArea < 0) ring.reverse();
    return [ring];
};

export const getSupportedCities = async () => {
    const [storedCities, importRuns] = await Promise.all([
        City.find({})
            .select('cityId name state country timezone boundary boundarySource boundaryMetadata osmBoundaryName osmBoundaryType osmBoundaryId osmAdminLevel boundaryUpdatedAt dataImportedAt osmDataTimestamp featureCount coverage featureImportStatus featureImportSource featureImportMessage')
            .lean(),
        Promise.all(SUPPORTED_CITIES.map(({ id }) => GeographicImportRun.findOne({ cityId: id })
            .sort({ startedAt: -1 })
            .select('cityId status mode source startedAt completedAt counts error')
            .lean())),
    ]);
    const storedById = new Map(storedCities.map((city) => [city.cityId, city]));
    const latestRunByCity = new Map();
    for (const run of importRuns) {
        if (run && !latestRunByCity.has(run.cityId)) latestRunByCity.set(run.cityId, run);
    }
    return SUPPORTED_CITIES.map((city) => {
        const stored = storedById.get(city.id);
        const latestImport = latestRunByCity.get(city.id) || null;
        return {
            ...city,
            cityId: city.id,
            available: isGeographicDataAvailable(stored),
            boundaryAvailable: Boolean(stored?.boundary?.type && (
                stored?.osmBoundaryId ||
                ['verified', 'prototype'].includes(stored?.boundaryMetadata?.verificationStatus)
            )),
            dataAvailable: isGeographicDataAvailable(stored),
            boundingBox: CITY_BOUNDING_BOXES[city.id],
            featureImportStatus: stored?.featureImportStatus || (
                isGeographicDataAvailable(stored) ? 'imported' : 'pending'
            ),
            featureImportSource: stored?.featureImportSource || null,
            featureImportMessage: stored?.featureImportMessage || null,
            dataImportedAt: stored?.dataImportedAt || null,
            latestImport,
            boundarySource: stored?.boundaryMetadata?.sourceName || stored?.boundarySource || null,
            boundaryType: stored?.boundaryMetadata?.boundaryType || (
                stored?.osmBoundaryId ? 'city-administrative-relation' : null
            ),
            boundarySourceType: stored?.boundaryMetadata?.sourceType || (stored?.osmBoundaryId ? 'osm' : null),
            verificationStatus: stored?.boundaryMetadata?.verificationStatus || (
                stored?.osmBoundaryId ? 'verified' : null
            ),
            verificationNotes: stored?.boundaryMetadata?.verificationNotes || null,
            boundarySourceUrl: stored?.boundaryMetadata?.sourceUrl || null,
            boundarySourceId: stored?.boundaryMetadata?.sourceId || null,
            boundaryLicense: stored?.boundaryMetadata?.license || null,
            boundaryLicenseUrl: stored?.boundaryMetadata?.licenseUrl || null,
            boundaryRetrievedAt: stored?.boundaryMetadata?.retrievedAt || stored?.boundaryUpdatedAt || null,
            boundaryName: stored?.osmBoundaryName || stored?.boundaryMetadata?.sourceName || null,
            osmBoundaryType: stored?.osmBoundaryType || null,
            osmBoundaryId: stored?.osmBoundaryId || null,
            adminLevel: stored?.osmAdminLevel || null,
            boundaryUpdatedAt: stored?.boundaryUpdatedAt || null,
            osmDataTimestamp: stored?.osmDataTimestamp || null,
            featureCount: stored?.featureCount || 0,
            coverage: stored?.coverage || {},
        };
    });
};

export const getCityById = (cityId) => City.findOne({ cityId }).lean();

export const getCityForPoint = async (latitude, longitude) => {
    const city = SUPPORTED_CITIES.find(({ id }) => isPointWithinCityBounds(id, latitude, longitude));
    return city ? { cityId: city.id } : null;
};

export const isPointInsideCity = (latitude, longitude, geometry) => {
    const pointInRing = (ring) => {
        let inside = false;
        for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
            const [x1, y1] = ring[index];
            const [x2, y2] = ring[previous];
            const cross = (longitude - x1) * (y2 - y1) - (latitude - y1) * (x2 - x1);
            if (
                Math.abs(cross) < 1e-10 &&
                longitude >= Math.min(x1, x2) - 1e-10 &&
                longitude <= Math.max(x1, x2) + 1e-10 &&
                latitude >= Math.min(y1, y2) - 1e-10 &&
                latitude <= Math.max(y1, y2) + 1e-10
            ) return true;
            const intersects = ((y1 > latitude) !== (y2 > latitude)) &&
                longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1;
            if (intersects) inside = !inside;
        }
        return inside;
    };
    const inPolygon = (polygon) => pointInRing(polygon[0]) &&
        !polygon.slice(1).some((hole) => pointInRing(hole));

    if (geometry?.type === 'Polygon') return inPolygon(geometry.coordinates);
    if (geometry?.type === 'MultiPolygon') return geometry.coordinates.some(inPolygon);
    return false;
};

export const getCityCoverage = async (cityId) => {
    const [city, latestImport] = await Promise.all([
        City.findOne({ cityId })
        .select('cityId name boundary boundarySource boundaryMetadata osmBoundaryName osmBoundaryType osmBoundaryId osmAdminLevel boundaryUpdatedAt dataImportedAt osmDataTimestamp featureCount coverage featureImportStatus featureImportSource featureImportMessage')
        .lean(),
        GeographicImportRun.findOne({ cityId })
            .sort({ startedAt: -1 })
            .select('status mode source startedAt completedAt counts error')
            .lean(),
    ]);
    const supportedCity = SUPPORTED_CITIES.find(({ id }) => id === cityId);
    if (!supportedCity) return null;

    return {
        cityId,
        name: city?.name || supportedCity.name,
        boundingBox: CITY_BOUNDING_BOXES[cityId],
        featureImportStatus: city?.featureImportStatus || (
            isGeographicDataAvailable(city) ? 'imported' : 'pending'
        ),
        featureImportSource: city?.featureImportSource || null,
        featureImportMessage: city?.featureImportMessage || null,
        latestImport,
        boundaryAvailable: Boolean(city?.boundary?.type && (
            city.osmBoundaryId ||
            ['verified', 'prototype'].includes(city.boundaryMetadata?.verificationStatus)
        )),
        boundarySource: city?.boundaryMetadata?.sourceName || city?.boundarySource || null,
        boundaryType: city?.boundaryMetadata?.boundaryType || (
            city?.osmBoundaryId ? 'city-administrative-relation' : null
        ),
        boundarySourceType: city?.boundaryMetadata?.sourceType || (city?.osmBoundaryId ? 'osm' : null),
        verificationStatus: city?.boundaryMetadata?.verificationStatus || (city?.osmBoundaryId ? 'verified' : null),
        verificationNotes: city?.boundaryMetadata?.verificationNotes || null,
        boundarySourceUrl: city?.boundaryMetadata?.sourceUrl || null,
        boundarySourceId: city?.boundaryMetadata?.sourceId || null,
        boundaryLicense: city?.boundaryMetadata?.license || null,
        boundaryLicenseUrl: city?.boundaryMetadata?.licenseUrl || null,
        boundaryRetrievedAt: city?.boundaryMetadata?.retrievedAt || city?.boundaryUpdatedAt || null,
        boundaryName: city?.osmBoundaryName || null,
        osmBoundaryType: city?.osmBoundaryType || null,
        osmBoundaryId: city?.osmBoundaryId || null,
        adminLevel: city?.osmAdminLevel || null,
        boundaryUpdatedAt: city?.boundaryUpdatedAt || null,
        dataImportedAt: city?.dataImportedAt || null,
        osmDataTimestamp: city?.osmDataTimestamp || null,
        featureCount: city?.featureCount || 0,
        coverage: city?.coverage || {},
        dataAvailable: isGeographicDataAvailable(city),
        available: isGeographicDataAvailable(city),
    };
};

export const findFeaturesNearSegments = async (cityId, segments, radiusMeters) => {
    const polygons = segments.map((segment) => corridorPolygon(segment.start, segment.end, radiusMeters));
    if (!polygons.length) return [];

    const features = await GeographicFeature.find({
        cityId,
        geometry: {
            $geoIntersects: {
                $geometry: { type: 'MultiPolygon', coordinates: polygons },
            },
        },
    })
        .select('osmType osmId geometry tags featureCategories source sourceTimestamp importedAt')
        .limit(MAX_ROUTE_FEATURES + 1)
        .lean();
    return {
        features: features.slice(0, MAX_ROUTE_FEATURES),
        truncated: features.length > MAX_ROUTE_FEATURES,
    };
};

export const getNearbyCityFeatures = async (cityId, latitude, longitude, radiusMeters, limit = 100) => (
    GeographicFeature.find({
        cityId,
        featureCategories: { $in: ['activity', 'emergency', 'publicTransport'] },
        geometry: {
            $near: {
                $geometry: { type: 'Point', coordinates: [longitude, latitude] },
                $maxDistance: radiusMeters,
            },
        },
    })
        .select('osmType osmId geometry tags featureCategories source sourceTimestamp importedAt')
        .limit(limit)
        .lean()
);
