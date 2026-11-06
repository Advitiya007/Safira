import { getCityCoverage, getCityForPoint, getNearbyCityFeatures } from './geographicDataService.js';

const createError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const haversine = (lat1, lon1, lat2, lon2) => {
    const radius = 6371;
    const deltaLatitude = (lat2 - lat1) * Math.PI / 180;
    const deltaLongitude = (lon2 - lon1) * Math.PI / 180;
    const value = Math.sin(deltaLatitude / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(deltaLongitude / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const getFeaturePoint = (geometry) => {
    if (geometry?.type === 'Point') return geometry.coordinates;
    const positions = [];
    const collect = (coordinates) => {
        if (
            Array.isArray(coordinates) &&
            coordinates.length >= 2 &&
            Number.isFinite(coordinates[0]) &&
            Number.isFinite(coordinates[1])
        ) {
            positions.push(coordinates);
        } else if (Array.isArray(coordinates)) {
            coordinates.forEach(collect);
        }
    };
    collect(geometry?.coordinates);
    if (!positions.length) return null;
    return positions.reduce(
        ([longitude, latitude], [nextLongitude, nextLatitude]) => [
            longitude + nextLongitude / positions.length,
            latitude + nextLatitude / positions.length,
        ],
        [0, 0],
    );
};

const classifyPlace = (tags = {}) => {
    if (tags.amenity === 'police') return { type: 'police', fallbackName: 'Local Police Station' };
    if (['hospital', 'clinic'].includes(tags.amenity)) {
        return { type: 'hospital', fallbackName: 'Local Hospital or Clinic' };
    }
    if (tags.amenity === 'pharmacy') return { type: 'safe_zone', fallbackName: 'Mapped Pharmacy' };
    if (
        ['public_transport', 'railway'].some((key) => tags[key]) ||
        tags.highway === 'bus_stop' ||
        tags.shop === 'mall' ||
        ['restaurant', 'cafe', 'community_centre', 'fire_station'].includes(tags.amenity)
    ) {
        return { type: 'safe_zone', fallbackName: 'Mapped Public Place' };
    }
    return null;
};

export const fetchNearbyPlaces = async (latitude, longitude, radius = 5000) => {
    const city = await getCityForPoint(latitude, longitude);
    if (!city) {
        throw createError('Location is outside supported city geographic coverage', 400);
    }
    const coverage = await getCityCoverage(city.cityId);
    if (!coverage?.available) {
        throw createError(
            `Geographic feature data has not been imported for ${coverage?.name || city.cityId}`,
            503,
        );
    }

    const features = await getNearbyCityFeatures(city.cityId, latitude, longitude, radius, 200);
    return features.flatMap((feature) => {
        const category = classifyPlace(feature.tags);
        const coordinates = getFeaturePoint(feature.geometry);
        if (!category || !coordinates) return [];
        const [lon, lat] = coordinates;
        const tags = feature.tags || {};
        return [{
            id: `${feature.osmType}/${feature.osmId}`,
            lat,
            lon,
            type: category.type,
            name: tags.name || category.fallbackName,
            address: tags['addr:full'] || tags['addr:street'] || '',
            distance: Number(haversine(latitude, longitude, lat, lon).toFixed(2)),
            phone: tags.phone || tags['contact:phone'] || null,
            website: tags.website || null,
            openingHours: tags.opening_hours || null,
            source: feature.source,
            importedAt: feature.importedAt,
            googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
        }];
    }).sort((first, second) => first.distance - second.distance);
};
