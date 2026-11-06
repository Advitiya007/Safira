import { getCityCoverage, getCityForPoint, findFeaturesNearSegments } from './geographicDataService.js';
import { isPointWithinCityBounds } from './osmBoundingBoxImportService.js';

const SAMPLE_LIMIT = 240;

const sampleCoordinates = (coordinates, limit = SAMPLE_LIMIT) => {
    if (coordinates.length <= limit) return coordinates;
    const samples = [];
    for (let index = 0; index < limit; index += 1) {
        samples.push(coordinates[Math.round(index * (coordinates.length - 1) / (limit - 1))]);
    }
    return samples;
};

const pointToSegmentMeters = (point, start, end) => {
    const latitude = point[0] * Math.PI / 180;
    const scaleX = 111320 * Math.cos(latitude);
    const scaleY = 110540;
    const pointX = point[1] * scaleX;
    const pointY = point[0] * scaleY;
    const startX = start[1] * scaleX;
    const startY = start[0] * scaleY;
    const endX = end[1] * scaleX;
    const endY = end[0] * scaleY;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const projection = lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared));
    return Math.hypot(pointX - (startX + projection * deltaX), pointY - (startY + projection * deltaY));
};

const distanceToRouteMeters = (point, route) => {
    let minimum = Infinity;
    for (let index = 1; index < route.length; index += 1) {
        minimum = Math.min(minimum, pointToSegmentMeters(point, route[index - 1], route[index]));
        if (minimum === 0) break;
    }
    return minimum;
};

const getElementPoint = (element) => {
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null;
};

const classifyFacility = (tags = {}) => {
    if (tags.amenity === 'police') return 'Police';
    if (tags.amenity === 'hospital') return 'Hospital';
    if (
        ['clinic', 'pharmacy', 'fire_station', 'community_centre', 'cafe', 'restaurant'].includes(tags.amenity) ||
        tags.public_transport === 'station' ||
        tags.shop === 'mall'
    ) return 'Public facility';
    return null;
};

const scoreRoute = (route, elements) => {
    const facilities = new Map();
    const majorRoadGeometries = [];

    for (const element of elements) {
        if (element.tags?.highway && Array.isArray(element.geometry)) {
            const geometry = element.geometry
                .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
                .map((point) => [point.lat, point.lon]);
            if (geometry.length > 1) majorRoadGeometries.push(geometry);
            continue;
        }

        const type = classifyFacility(element.tags);
        const point = getElementPoint(element);
        if (!type || !point || distanceToRouteMeters(point, route) > 500) continue;

        const id = `${element.type}:${element.id}`;
        if (facilities.has(id)) continue;
        facilities.set(id, {
            id,
            name: element.tags?.name || type,
            type,
            lat: point[0],
            lon: point[1],
            source: 'OpenStreetMap',
        });
    }

    const samples = sampleCoordinates(route);
    let mainRoadSamples = 0;
    for (const sample of samples) {
        const nearMainRoad = majorRoadGeometries.some((geometry) => {
            for (let index = 1; index < geometry.length; index += 1) {
                if (pointToSegmentMeters(sample, geometry[index - 1], geometry[index]) <= 75) return true;
            }
            return false;
        });
        if (nearMainRoad) mainRoadSamples += 1;
    }

    const facilityList = [...facilities.values()];
    const policeCount = facilityList.filter((facility) => facility.type === 'Police').length;
    const hospitalCount = facilityList.filter((facility) => facility.type === 'Hospital').length;
    const publicFacilityCount = facilityList.filter((facility) => facility.type === 'Public facility').length;
    const mainRoadCoveragePercent = majorRoadGeometries.length
        ? Math.round(mainRoadSamples * 100 / samples.length)
        : null;
    const emergencySupport = policeCount + hospitalCount;
    const roadWeight = mainRoadCoveragePercent === null ? 0 : 0.4;
    const availableWeight = roadWeight + 0.4 + 0.2;
    const score = Math.round((
        (mainRoadCoveragePercent ?? 0) * roadWeight +
        Math.min(emergencySupport / 4, 1) * 40 +
        Math.min(publicFacilityCount / 8, 1) * 20
    ) / availableWeight);

    return {
        score,
        mainRoadCoveragePercent,
        policeCount,
        hospitalCount,
        publicFacilityCount,
        facilities: facilityList,
        source: 'OpenStreetMap',
    };
};

const collectPositions = (coordinates, positions = []) => {
    if (
        Array.isArray(coordinates) &&
        coordinates.length >= 2 &&
        Number.isFinite(coordinates[0]) &&
        Number.isFinite(coordinates[1])
    ) {
        positions.push(coordinates);
    } else if (Array.isArray(coordinates)) {
        coordinates.forEach((coordinate) => collectPositions(coordinate, positions));
    }
    return positions;
};

const featureToElements = (feature) => {
    const tags = feature.tags || {};
    const featureId = `${feature.osmType}:${feature.osmId}`;
    if (
        ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(tags.highway) &&
        ['LineString', 'MultiLineString'].includes(feature.geometry?.type)
    ) {
        const lines = feature.geometry.type === 'LineString'
            ? [feature.geometry.coordinates]
            : feature.geometry.coordinates;
        return lines.filter((line) => line.length > 1).map((line, index) => ({
            type: feature.osmType,
            id: `${featureId}:${index}`,
            tags,
            geometry: line.map(([lon, lat]) => ({ lat, lon })),
        }));
    }
    const positions = collectPositions(feature.geometry?.coordinates);
    if (!positions.length) return [];
    const [longitude, latitude] = positions.reduce(
        ([lon, lat], [nextLon, nextLat]) => [lon + nextLon / positions.length, lat + nextLat / positions.length],
        [0, 0],
    );
    return [{
        type: feature.osmType,
        id: featureId,
        tags,
        lat: latitude,
        lon: longitude,
    }];
};

export const getRouteSafetyIndicators = async (routes) => {
    const firstCoordinate = routes[0]?.[0];
    const city = firstCoordinate
        ? await getCityForPoint(firstCoordinate[0], firstCoordinate[1])
        : null;
    if (!city || routes.some((route) => route.some(([latitude, longitude]) => (
        !isPointWithinCityBounds(city.cityId, latitude, longitude)
    )))) {
        throw Object.assign(
            new Error('Route is outside supported city geographic coverage'),
            { statusCode: 400 },
        );
    }
    const coverage = await getCityCoverage(city.cityId);
    if (!coverage?.available) {
        throw Object.assign(
            new Error(`Geographic feature data has not been imported for ${coverage?.name || city.cityId}`),
            { statusCode: 503 },
        );
    }
    const segments = routes.flatMap((route) => route.slice(1).map((point, index) => ({
        start: route[index],
        end: point,
    })));
    const result = await findFeaturesNearSegments(city.cityId, segments, 500);
    const elements = result.features.flatMap(featureToElements);
    return routes.map((route) => scoreRoute(route, elements));
};
