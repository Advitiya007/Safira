import {
    EMERGENCY_FACILITY_SEARCH_RADIUS_METERS,
    ROUTE_MODES,
} from '../config/safeRouteConfig.js';
import { getOpeningStatus } from './openingHoursService.js';
import { distanceMeters } from './routeSegmentationService.js';

const ACTIVITY_AMENITIES = new Set([
    'restaurant', 'cafe', 'fast_food', 'pub', 'bar', 'food_court', 'marketplace',
    'pharmacy', 'fuel',
]);
const EMERGENCY_AMENITIES = new Set(['police', 'hospital', 'clinic', 'pharmacy']);
const TRANSPORT_TAGS = new Set(['bus_stop', 'station', 'halt', 'tram_stop']);
const SCORING_CATEGORIES = [
    'nightActivity', 'lighting', 'roadAccessibility', 'cctv',
    'emergencyAccess', 'publicTransport', 'isolation',
];

const pointToSegmentMeters = (point, start, end) => {
    const latitude = (point[0] + start[0] + end[0]) / 3 * Math.PI / 180;
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
    const ratio = lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared));
    return Math.hypot(pointX - startX - ratio * deltaX, pointY - startY - ratio * deltaY);
};

const getRouteFeatures = (segments, features, searchRadiusMeters) => features.filter((feature) => (
    segments.some((segment) => featureDistanceToSegment(feature, segment) <= searchRadiusMeters)
));

const geometryPaths = (geometry) => {
    if (!geometry) return [];
    if (geometry.type === 'LineString') return [geometry.coordinates];
    if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') return geometry.coordinates;
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
    return [];
};

const segmentsIntersect = (a, b, c, d) => {
    const cross = (first, second, third) => (
        (second[0] - first[0]) * (third[1] - first[1]) -
        (second[1] - first[1]) * (third[0] - first[0])
    );
    const first = cross(a, b, c);
    const second = cross(a, b, d);
    const third = cross(c, d, a);
    const fourth = cross(c, d, b);
    const within = (value, firstValue, secondValue) => (
        value >= Math.min(firstValue, secondValue) - 1e-8 &&
        value <= Math.max(firstValue, secondValue) + 1e-8
    );
    if (Math.abs(first) < 1e-8 && within(c[0], a[0], b[0]) && within(c[1], a[1], b[1])) return true;
    if (Math.abs(second) < 1e-8 && within(d[0], a[0], b[0]) && within(d[1], a[1], b[1])) return true;
    if (Math.abs(third) < 1e-8 && within(a[0], c[0], d[0]) && within(a[1], c[1], d[1])) return true;
    if (Math.abs(fourth) < 1e-8 && within(b[0], c[0], d[0]) && within(b[1], c[1], d[1])) return true;
    return first * second < 0 && third * fourth < 0;
};

const segmentToSegmentMeters = (firstStart, firstEnd, secondStart, secondEnd) => {
    const latitude = (firstStart[0] + firstEnd[0] + secondStart[0] + secondEnd[0]) / 4 * Math.PI / 180;
    const scaleX = 111320 * Math.cos(latitude);
    const scaleY = 110540;
    const project = ([lat, lon]) => [lon * scaleX, lat * scaleY];
    const a = project(firstStart);
    const b = project(firstEnd);
    const c = project(secondStart);
    const d = project(secondEnd);
    if (segmentsIntersect(a, b, c, d)) return 0;
    return Math.min(
        pointToSegmentMeters(firstStart, secondStart, secondEnd),
        pointToSegmentMeters(firstEnd, secondStart, secondEnd),
        pointToSegmentMeters(secondStart, firstStart, firstEnd),
        pointToSegmentMeters(secondEnd, firstStart, firstEnd),
    );
};

const featureDistanceToSegment = (feature, segment) => {
    const { geometry } = feature;
    if (!geometry) return Infinity;
    if (geometry.type === 'Point') {
        const [longitude, latitude] = geometry.coordinates;
        return pointToSegmentMeters([latitude, longitude], segment.start, segment.end);
    }

    if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
        const center = segment.center;
        const polygons = feature.geometry.type === 'Polygon'
            ? [feature.geometry.coordinates]
            : feature.geometry.coordinates;
        for (const polygon of polygons) {
            const pointInRing = (ring) => {
                let inside = false;
                for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
                    const [x1, y1] = ring[index];
                    const [x2, y2] = ring[previous];
                    if (((y1 > center[0]) !== (y2 > center[0])) &&
                        center[1] < ((x2 - x1) * (center[0] - y1)) / (y2 - y1) + x1) inside = !inside;
                }
                return inside;
            };
            if (pointInRing(polygon[0]) && !polygon.slice(1).some(pointInRing)) return 0;
        }
    }

    let minimum = Infinity;
    for (const path of geometryPaths(geometry)) {
        for (let index = 1; index < path.length; index += 1) {
            const first = [path[index - 1][1], path[index - 1][0]];
            const second = [path[index][1], path[index][0]];
            minimum = Math.min(
                minimum,
                segmentToSegmentMeters(segment.start, segment.end, first, second),
            );
        }
    }
    return minimum;
};

const getFeatureTags = (feature) => feature.tags || {};
const isEmergencyFacility = (tags) => EMERGENCY_AMENITIES.has(tags.amenity);
const isPublicTransport = (tags) => (
    TRANSPORT_TAGS.has(tags.highway) ||
    TRANSPORT_TAGS.has(tags.public_transport) ||
    tags.railway === 'station' ||
    tags.railway === 'halt' ||
    tags.amenity === 'bus_station'
);

const isEstablishment = (tags) => Boolean(
    (tags.shop && tags.shop !== 'no') ||
    ACTIVITY_AMENITIES.has(tags.amenity),
);

const getFeatureMapPoint = (feature) => {
    const { geometry } = feature;
    if (geometry.type === 'Point') return geometry.coordinates;
    const paths = geometryPaths(geometry);
    const coordinates = paths.flat();
    if (!coordinates.length) return null;
    const longitude = coordinates.reduce((sum, coordinate) => sum + coordinate[0], 0) / coordinates.length;
    const latitude = coordinates.reduce((sum, coordinate) => sum + coordinate[1], 0) / coordinates.length;
    return [longitude, latitude];
};

const getFeatureLabel = (tags) => {
    if (tags.amenity === 'police') return 'Police';
    if (['hospital', 'clinic'].includes(tags.amenity)) return tags.amenity === 'clinic' ? 'Clinic' : 'Hospital';
    if (tags.amenity === 'pharmacy') return 'Pharmacy';
    if (isPublicTransport(tags)) return 'Public transport';
    if (isEstablishment(tags)) return 'Mapped establishment';
    return null;
};

export const getRouteFacilities = (segments, features, searchRadiusMeters, limit = 100) => {
    const facilities = [];
    const seen = new Set();
    for (const feature of features) {
        const key = `${feature.osmType}:${feature.osmId}`;
        if (seen.has(key)) continue;
        const tags = getFeatureTags(feature);
        const type = getFeatureLabel(tags);
        if (!type) continue;
        const distance = Math.min(...segments.map((segment) => featureDistanceToSegment(feature, segment)));
        const facilityRadius = isEmergencyFacility(tags)
            ? EMERGENCY_FACILITY_SEARCH_RADIUS_METERS
            : searchRadiusMeters;
        if (distance > facilityRadius) continue;
        const [longitude, latitude] = getFeatureMapPoint(feature) || [];
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
        seen.add(key);
        facilities.push({
            id: key,
            name: tags.name || type,
            type,
            lat: latitude,
            lon: longitude,
            distanceMeters: Math.round(distance),
            source: 'OpenStreetMap',
        });
    }
    return facilities.sort((first, second) => first.distanceMeters - second.distanceMeters).slice(0, limit);
};

const getRoadAccessibilityScore = (roads, mode) => {
    const values = roads.map(({ tags }) => {
        if (mode === 'walking') {
            if (['no', 'private'].includes(tags.foot)) return 0;
            const highway = tags.highway;
            if (['footway', 'pedestrian', 'path', 'steps'].includes(highway)) return 100;
            if (['residential', 'living_street', 'tertiary', 'service'].includes(highway)) return 85;
            if (['secondary', 'primary'].includes(highway)) return 65;
            if (['trunk', 'motorway'].includes(highway)) return 15;
            if (highway === 'track') return 60;
            if (highway === 'unclassified') return 80;
            return null;
        }
        if (['no', 'private'].includes(tags.motor_vehicle || tags.vehicle)) return 0;
        const highway = tags.highway;
        if (['motorway', 'trunk', 'primary'].includes(highway)) return 100;
        if (['secondary', 'tertiary'].includes(highway)) return 85;
        if (['residential', 'living_street'].includes(highway)) return 70;
        if (highway === 'service') return 55;
        if (highway === 'unclassified') return 55;
        if (['footway', 'pedestrian', 'path', 'steps', 'cycleway'].includes(highway)) return 0;
        if (highway === 'track') return 35;
        return null;
    });
    const mappedValues = values.filter(Number.isFinite);
    return mappedValues.length
        ? mappedValues.reduce((sum, score) => sum + score, 0) / mappedValues.length
        : null;
};

const scoreSegment = (segment, features, options) => {
    const { mode, timezone, searchRadiusMeters } = options;
    const emergencyRadius = options.emergencySearchRadiusMeters ||
        EMERGENCY_FACILITY_SEARCH_RADIUS_METERS;
    const nearby = features
        .map((feature) => ({ feature, distance: featureDistanceToSegment(feature, segment) }))
        .filter(({ feature, distance }) => (
            distance <= (isEmergencyFacility(getFeatureTags(feature))
                ? (options.emergencySearchRadiusMeters || EMERGENCY_FACILITY_SEARCH_RADIUS_METERS)
                : searchRadiusMeters)
        ));
    const tagsFor = (predicate) => nearby
        .filter(({ feature }) => predicate(getFeatureTags(feature)))
        .map(({ feature, distance }) => ({ tags: getFeatureTags(feature), distance, feature }));
    const establishments = tagsFor(isEstablishment);
    const evaluatedEstablishments = establishments.map((establishment) => ({
        ...establishment,
        opening: getOpeningStatus(
            establishment.tags.opening_hours,
            segment.estimatedArrival,
            timezone,
        ),
    }));
    const knownHours = evaluatedEstablishments.filter(({ opening }) => opening.status !== 'unknown');
    const openEstablishments = knownHours.filter(({ opening }) => opening.status === 'open');

    const roads = tagsFor((tags) => Boolean(
        tags.highway && !['street_lamp', 'bus_stop'].includes(tags.highway),
    ));
    const lights = tagsFor((tags) => tags.highway === 'street_lamp');
    const lightingSignals = [
        ...lights.map(() => 100),
        ...roads
            .filter(({ tags }) => ['yes', 'no', 'limited'].includes(tags.lit))
            .map(({ tags }) => tags.lit === 'yes' ? 100 : tags.lit === 'limited' ? 50 : 0),
    ];
    const surveillance = tagsFor((tags) => tags.man_made === 'surveillance');
    const emergency = tagsFor(isEmergencyFacility);
    const publicTransport = tagsFor(isPublicTransport);
    const mappedActivity = establishments.length > 0;
    const metrics = {
        nightActivity: knownHours.length
            ? Math.min(openEstablishments.length / 2, 1) * 100
            : null,
        lighting: lightingSignals.length
            ? lightingSignals.reduce((sum, value) => sum + value, 0) / lightingSignals.length
            : null,
        roadAccessibility: getRoadAccessibilityScore(roads, mode),
        cctv: surveillance.length
            ? 100 * (1 - Math.min(Math.min(...surveillance.map(({ distance }) => distance)) / searchRadiusMeters, 1))
            : null,
        emergencyAccess: emergency.length
            ? 100 * (1 - Math.min(Math.min(...emergency.map(({ distance }) => distance)) / emergencyRadius, 1))
            : null,
        publicTransport: publicTransport.length
            ? 100 * (1 - Math.min(Math.min(...publicTransport.map(({ distance }) => distance)) / searchRadiusMeters, 1))
            : null,
        isolation: mappedActivity ? 100 : options.routeHasMappedActivity ? 0 : null,
    };
    const weights = ROUTE_MODES[mode].weights;
    const availableWeight = SCORING_CATEGORIES
        .filter((category) => Number.isFinite(metrics[category]))
        .reduce((sum, category) => sum + weights[category], 0);
    const score = availableWeight
        ? SCORING_CATEGORIES.reduce((sum, category) => (
            sum + (Number.isFinite(metrics[category]) ? metrics[category] * weights[category] : 0)
        ), 0)
        : null;
    const observed = Object.fromEntries(SCORING_CATEGORIES.map((category) => [
        category,
        Number.isFinite(metrics[category]) && (category !== 'isolation' || mappedActivity),
    ]));

    return {
        ...segment,
        score: score === null ? null : Math.round(score),
        indicators: Object.fromEntries(
            SCORING_CATEGORIES.map((category) => [category, metrics[category] === null ? null : Math.round(metrics[category])]),
        ),
        evidence: {
            openEstablishmentCount: openEstablishments.length,
            unknownHoursCount: evaluatedEstablishments.length - knownHours.length,
            mappedActivityCount: establishments.length,
            streetLampCount: lights.length,
            cctvCount: surveillance.length,
            policeCount: emergency.filter(({ tags }) => tags.amenity === 'police').length,
            hospitalCount: emergency.filter(({ tags }) => ['hospital', 'clinic'].includes(tags.amenity)).length,
            pharmacyCount: emergency.filter(({ tags }) => tags.amenity === 'pharmacy').length,
            publicTransportCount: publicTransport.length,
        },
        _observedIndicators: observed,
        _hasActivityData: mappedActivity,
    };
};

const getLongestIsolationMeters = (segments) => {
    let current = 0;
    let longest = 0;
    for (const segment of segments) {
        if (!segment._hasActivityData) {
            current += segment.distanceMeters;
            longest = Math.max(longest, current);
        } else {
            current = 0;
        }
    }
    return Math.round(longest);
};

const getFreshnessFactor = (timestamp, now) => {
    if (!timestamp || !Number.isFinite(new Date(timestamp).getTime())) return 0.5;
    const ageDays = Math.max(0, (now.getTime() - new Date(timestamp).getTime()) / 86400000);
    if (ageDays <= 30) return 1;
    if (ageDays <= 90) return 0.85;
    if (ageDays <= 365) return 0.65;
    return 0.4;
};

export const scoreRouteSegments = (segments, features, options) => {
    const emergencyRadius = options.emergencySearchRadiusMeters ||
        EMERGENCY_FACILITY_SEARCH_RADIUS_METERS;
    const routeFeatures = getRouteFeatures(
        segments,
        features,
        Math.max(options.searchRadiusMeters, emergencyRadius),
    );
    const routeHasMappedActivity = getRouteFeatures(segments, routeFeatures, options.searchRadiusMeters)
        .some((feature) => isEstablishment(getFeatureTags(feature)));
    const scoringOptions = { ...options, routeHasMappedActivity };
    const scoredSegments = segments.map((segment) => scoreSegment(segment, routeFeatures, scoringOptions));
    const availableSegments = scoredSegments.filter((segment) => segment.score !== null);
    const totalDistance = scoredSegments.reduce((sum, segment) => sum + segment.distanceMeters, 0);
    const scoredDistance = availableSegments.reduce((sum, segment) => sum + segment.distanceMeters, 0);
    const averageScore = availableSegments.length && totalDistance
        ? availableSegments.reduce((sum, segment) => sum + segment.score * segment.distanceMeters, 0) / totalDistance
        : null;
    const weakSegments = availableSegments
        .map((segment) => segment.score)
        .sort((first, second) => first - second)
        .slice(0, Math.max(1, Math.ceil(availableSegments.length * 0.1)));
    const weakSegmentAverage = weakSegments.length
        ? weakSegments.reduce((sum, score) => sum + score, 0) / weakSegments.length
        : null;
    const routeScore = averageScore === null
        ? null
        : Math.round(Math.min(
            averageScore,
            weakSegmentAverage === null
                ? averageScore
                : averageScore * 0.75 + weakSegmentAverage * 0.25,
        ));
    const observedCount = SCORING_CATEGORIES.reduce((sum, category) => (
        sum + scoredSegments.filter((segment) => segment._observedIndicators[category]).length
    ), 0);
    const coverageRatio = scoredSegments.length
        ? observedCount / (scoredSegments.length * SCORING_CATEGORIES.length)
        : 0;
    const knownHours = scoredSegments.reduce((sum, segment) => (
        sum + Math.max(0, segment.evidence.mappedActivityCount - segment.evidence.unknownHoursCount)
    ), 0);
    const mappedActivities = scoredSegments.reduce((sum, segment) => (
        sum + segment.evidence.mappedActivityCount
    ), 0);
    const activityHoursReliability = mappedActivities ? knownHours / mappedActivities : 0;
    const freshnessFactor = getFreshnessFactor(options.osmDataTimestamp, options.now || new Date());
    const confidence = Math.round(
        100 * coverageRatio * (0.7 + 0.3 * activityHoursReliability) *
        freshnessFactor * (options.featureQueryTruncated ? 0.5 : 1),
    );

    const explanations = [];
    const openActivityCoverage = scoredSegments.length
        ? Math.round(scoredSegments.filter((segment) => segment.evidence.openEstablishmentCount > 0).length * 100 / scoredSegments.length)
        : 0;
    if (openActivityCoverage) explanations.push(`Mapped establishments with listed hours are open in ${openActivityCoverage}% of route segments.`);
    if (mappedActivities > knownHours) explanations.push('Opening hours are unknown for some mapped establishments; they are not counted as open or closed.');
    const lightingCoverage = scoredSegments.filter((segment) => segment.indicators.lighting !== null).length;
    if (lightingCoverage) explanations.push(`Street-light information is mapped for ${Math.round(lightingCoverage * 100 / scoredSegments.length)}% of route segments.`);
    const emergencyCount = routeFeatures.filter((feature) => isEmergencyFacility(getFeatureTags(feature))).length;
    if (emergencyCount) explanations.push(`${emergencyCount} mapped police, hospital/clinic, or pharmacy records are near the route.`);
    const longestIsolationMeters = routeHasMappedActivity
        ? getLongestIsolationMeters(scoredSegments)
        : null;
    if (longestIsolationMeters) explanations.push(`Longest stretch without a mapped establishment nearby: ${(longestIsolationMeters / 1000).toFixed(1)} km.`);
    if (!routeHasMappedActivity) explanations.push('No mapped establishments were found within this route analysis corridor; activity and isolation comparisons are unavailable.');
    if (options.featureQueryTruncated) explanations.push('The mapped-feature query reached its result limit; indicator coverage may be incomplete.');
    if (!explanations.length) explanations.push('Mapped safety indicators are insufficient to compare this route.');

    const publicFeatureCount = new Set(routeFeatures.map((feature) => `${feature.osmType}:${feature.osmId}`)).size;
    const indicators = Object.fromEntries(SCORING_CATEGORIES.map((category) => {
        const measured = scoredSegments.filter((segment) => Number.isFinite(segment.indicators[category]));
        const measuredDistance = measured.reduce((sum, segment) => sum + segment.distanceMeters, 0);
        const score = measuredDistance
            ? measured.reduce(
                (sum, segment) => sum + segment.indicators[category] * segment.distanceMeters,
                0,
            ) / measuredDistance
            : null;
        return [category, {
            score: score === null ? null : Math.round(score),
            coveragePercent: totalDistance
                ? Math.round(measuredDistance * 100 / totalDistance)
                : 0,
        }];
    }));
    const emergencyFacilities = getRouteFacilities(
        segments,
        routeFeatures.filter((feature) => isEmergencyFacility(getFeatureTags(feature))),
        emergencyRadius,
    );
    const nearestEmergencyFacilityMeters = emergencyFacilities.length
        ? emergencyFacilities[0].distanceMeters
        : null;
    const lightingCoveragePercent = indicators.lighting.coveragePercent;
    const nightActivityCoveragePercent = indicators.nightActivity.coveragePercent;
    const cctvCoveragePercent = indicators.cctv.coveragePercent;
    if (nearestEmergencyFacilityMeters !== null) {
        explanations.push(
            `Nearest mapped police, hospital/clinic, or pharmacy is ${nearestEmergencyFacilityMeters} m from the route (straight-line distance).`,
        );
    } else {
        explanations.push('No mapped emergency facility was found within 1 km; coverage beyond mapped records is unknown.');
    }
    const returnedSegments = scoredSegments.map((segment) => {
        const { _observedIndicators, _hasActivityData, ...safeSegment } = segment;
        return safeSegment;
    });

    return {
        score: routeScore,
        confidence,
        indicators,
        indicatorCoverage: {
            lighting: lightingCoveragePercent,
            nightActivity: nightActivityCoveragePercent,
            cctv: cctvCoveragePercent,
        },
        emergencyFacilityCount: emergencyFacilities.length,
        nearestEmergencyFacilityMeters,
        scoredSegmentCoveragePercent: totalDistance
            ? Math.round(scoredDistance * 100 / totalDistance)
            : 0,
        longestMappedActivityGapMeters: longestIsolationMeters,
        mappedFeatureCount: publicFeatureCount,
        facilities: getRouteFacilities(segments, routeFeatures, options.searchRadiusMeters),
        explanations,
        segments: returnedSegments,
    };
};
