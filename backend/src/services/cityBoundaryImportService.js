import booleanValid from '@turf/boolean-valid';
import polygonClipping from 'polygon-clipping';
import {
    CITY_BOUNDARY_IDENTITY_NAMES,
    CITY_BOUNDARY_REFERENCE_POINTS,
    CITY_BOUNDARY_SOURCE_PRIORITY,
    SUPPORTED_CITIES,
} from '../config/safeRouteConfig.js';
import City from '../models/City.js';
import { isPointInsideCity } from './geographicDataService.js';

const SOURCE_TYPES = new Set(Object.keys(CITY_BOUNDARY_SOURCE_PRIORITY)
    .filter((sourceType) => sourceType !== 'osm'));

const normalizeCrs = (crs) => String(crs || '')
    .trim()
    .toUpperCase()
    .replace(/^URN:OGC:DEF:CRS:EPSG::/, 'EPSG:')
    .replace(/^EPSG\s*:\s*/, 'EPSG:');

const getGeoJsonCrs = (geoJson) => {
    const crsName = geoJson.crs?.properties?.name;
    if (!crsName) return null;
    if (/^urn:ogc:def:crs:ogc:.*:crs84$/i.test(crsName)) return 'OGC:CRS84';
    const match = String(crsName).match(/(?:EPSG(?::|::)|\/)(\d+)$/i);
    if (!match) return normalizeCrs(crsName);
    return `EPSG:${match[1]}`;
};

const transformPosition = (position, sourceCrs) => {
    if (
        !Array.isArray(position) ||
        position.length < 2 ||
        !position.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    ) {
        throw new Error('Boundary contains an invalid coordinate position');
    }
    const [x, y, ...extra] = position;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('Boundary contains a non-numeric coordinate');
    }
    if (sourceCrs === 'EPSG:4326' || sourceCrs === 'CRS84' || sourceCrs === 'OGC:CRS84') {
        if (x < -180 || x > 180 || y < -90 || y > 90) {
            throw new Error('EPSG:4326 coordinates must be within longitude/latitude ranges');
        }
        return [x, y, ...extra];
    }
    if (sourceCrs === 'EPSG:3857') {
        const longitude = (x / 6378137) * (180 / Math.PI);
        const latitude = (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * (180 / Math.PI);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
            longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
            throw new Error('EPSG:3857 coordinate is outside the supported WGS84 domain');
        }
        return [longitude, latitude, ...extra];
    }
    throw new Error(`Unsupported boundary CRS "${sourceCrs}"; supported input CRS values are EPSG:4326 and EPSG:3857`);
};

const mapCoordinates = (coordinates, sourceCrs) => {
    if (!Array.isArray(coordinates)) throw new Error('Boundary coordinates must be arrays');
    if (coordinates.length >= 2 && !Array.isArray(coordinates[0])) {
        return transformPosition(coordinates, sourceCrs);
    }
    return coordinates.map((coordinate) => mapCoordinates(coordinate, sourceCrs));
};

const getFeatureCollection = (geoJson) => {
    if (geoJson?.type === 'FeatureCollection' && Array.isArray(geoJson.features)) {
        return geoJson.features;
    }
    if (geoJson?.type === 'Feature') return [geoJson];
    if (geoJson?.type === 'Polygon' || geoJson?.type === 'MultiPolygon') {
        return [{ type: 'Feature', properties: {}, geometry: geoJson }];
    }
    throw new Error('Boundary input must be a GeoJSON Feature, FeatureCollection, Polygon, or MultiPolygon');
};

const validateManifest = (city, manifest) => {
    const requiredFields = [
        'cityId',
        'sourceType',
        'boundaryType',
        'sourceName',
        'sourceUrl',
        'sourceId',
        'retrievedAt',
        'license',
        'licenseUrl',
        'verificationStatus',
        'verificationNotes',
        'crs',
    ];
    const missingFields = requiredFields.filter((field) => (
        typeof manifest?.[field] !== 'string' || !manifest[field].trim()
    ));
    if (missingFields.length) throw new Error(`Boundary manifest is missing: ${missingFields.join(', ')}`);
    if (manifest.cityId !== city.id) {
        throw new Error(`Boundary manifest cityId "${manifest.cityId}" does not match ${city.id}`);
    }
    if (!SOURCE_TYPES.has(manifest.sourceType)) {
        throw new Error(`Unsupported boundary sourceType "${manifest.sourceType}"`);
    }
    const expectedBoundaryTypes = {
        'official-municipal': 'municipal-limits',
        'official-wards': 'ward-union',
        'other-administrative': 'other-city-boundary',
        'prototype-study-area': 'urban-study-area',
    };
    if (manifest.boundaryType !== expectedBoundaryTypes[manifest.sourceType]) {
        throw new Error(
            `${manifest.sourceType} sources must declare boundaryType "${expectedBoundaryTypes[manifest.sourceType]}"`,
        );
    }
    if (/\b(district|tehsil|sub[- ]?district|adm[0-9])\b/i.test(manifest.boundaryType)) {
        throw new Error('District, tehsil, and generic administrative-level boundaries cannot be city boundaries');
    }
    const sourceUrl = new URL(manifest.sourceUrl);
    const licenseUrl = new URL(manifest.licenseUrl);
    if (!['http:', 'https:'].includes(sourceUrl.protocol) || !['http:', 'https:'].includes(licenseUrl.protocol)) {
        throw new Error('Boundary sourceUrl and licenseUrl must use HTTP or HTTPS');
    }
    if (/^(unknown|unspecified|n\/?a)$/i.test(manifest.license.trim())) {
        throw new Error('Boundary license must be identified; unknown licenses are not accepted');
    }
    if (!['verified', 'prototype'].includes(manifest.verificationStatus)) {
        throw new Error(`Unsupported verificationStatus "${manifest.verificationStatus}"`);
    }
    const isPrototype = manifest.sourceType === 'prototype-study-area';
    if (isPrototype !== (manifest.verificationStatus === 'prototype')) {
        throw new Error('Prototype study-area sources must be marked prototype; other boundary sources must be verified');
    }
    const retrievedAt = new Date(manifest.retrievedAt);
    if (!Number.isFinite(retrievedAt.getTime())) throw new Error('Boundary manifest retrievedAt must be a valid date');

    if (!isPrototype) {
        const identity = manifest.identity;
        if (
            !identity ||
            typeof identity.cityField !== 'string' ||
            typeof identity.cityValue !== 'string' ||
            typeof identity.stateField !== 'string' ||
            typeof identity.stateValue !== 'string'
        ) {
            throw new Error('Verified boundaries require identity cityField/cityValue and stateField/stateValue');
        }
        const acceptedNames = CITY_BOUNDARY_IDENTITY_NAMES[city.id] || [city.name];
        if (!acceptedNames.some((name) => normalizeIdentity(identity.cityValue) === normalizeIdentity(name)) ||
            normalizeIdentity(identity.stateValue) !== normalizeIdentity(city.state)) {
            throw new Error(`Boundary identity must explicitly match ${city.name}, ${city.state}`);
        }
        if (
            manifest.sourceType === 'official-wards' &&
            (!identity.wardIdField ||
                !Number.isInteger(manifest.expectedFeatureCount) ||
                manifest.expectedFeatureCount < 2)
        ) {
            throw new Error('Ward sources require identity.wardIdField and expectedFeatureCount');
        }
    } else if (manifest.verificationNotes.trim().length < 40) {
        throw new Error('Prototype study areas require detailed scope and limitation notes');
    }

    return {
        retrievedAt,
        sourceCrs: normalizeCrs(manifest.crs),
    };
};

const normalizeIdentity = (value) => String(value || '').trim().toLocaleLowerCase();

const validateFeatureIdentity = (feature, identity) => {
    const properties = feature.properties;
    if (!properties || typeof properties !== 'object') {
        throw new Error('Every municipal or ward feature must include identity properties');
    }
    if (
        normalizeIdentity(properties[identity.cityField]) !== normalizeIdentity(identity.cityValue) ||
        normalizeIdentity(properties[identity.stateField]) !== normalizeIdentity(identity.stateValue)
    ) {
        throw new Error(
            `Feature identity did not match ${identity.cityValue}, ${identity.stateValue}`,
        );
    }
};

const validateFeatureGeometry = (feature, sourceCrs) => {
    if (feature?.type !== 'Feature' || !feature.geometry ||
        !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) {
        throw new Error('Every boundary feature must have a Polygon or MultiPolygon geometry');
    }
    const geometry = {
        type: feature.geometry.type,
        coordinates: mapCoordinates(feature.geometry.coordinates, sourceCrs),
    };
    const normalizedFeature = {
        type: 'Feature',
        properties: feature.properties || {},
        geometry,
    };
    if (!booleanValid(normalizedFeature)) {
        throw new Error('Boundary contains invalid polygon topology (for example, an unclosed or self-intersecting ring)');
    }
    return geometry;
};

const asMultiPolygonCoordinates = (geometry) => (
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
);

const mergeBoundaryFeatures = (geometries) => {
    let merged;
    try {
        merged = polygonClipping.union(...geometries.map(asMultiPolygonCoordinates));
    } catch (error) {
        throw new Error(`Could not merge boundary polygons: ${error.message}`);
    }
    if (!Array.isArray(merged) || !merged.length) throw new Error('Boundary union produced no polygon area');
    return merged.length === 1
        ? { type: 'Polygon', coordinates: merged[0] }
        : { type: 'MultiPolygon', coordinates: merged };
};

const getFeatureIdentityManifest = (manifest) => manifest.identity || null;

export const normalizeCityBoundarySource = (cityId, geoJson, manifest) => {
    const city = SUPPORTED_CITIES.find((supportedCity) => supportedCity.id === cityId);
    if (!city) throw new Error(`Unsupported city "${cityId}"`);
    const { retrievedAt, sourceCrs } = validateManifest(city, manifest);
    const declaredGeoJsonCrs = getGeoJsonCrs(geoJson);
    if (declaredGeoJsonCrs && declaredGeoJsonCrs !== sourceCrs) {
        throw new Error(`GeoJSON CRS ${declaredGeoJsonCrs} conflicts with manifest CRS ${sourceCrs}`);
    }
    if (!['EPSG:4326', 'EPSG:3857', 'CRS84', 'OGC:CRS84'].includes(sourceCrs)) {
        throw new Error(`Unsupported boundary CRS "${sourceCrs}"`);
    }

    const features = getFeatureCollection(geoJson);
    if (!features.length) throw new Error('Boundary source contains no features');
    const identity = getFeatureIdentityManifest(manifest);
    const wardIds = new Set();
    const geometries = features.map((feature) => {
        if (identity) validateFeatureIdentity(feature, identity);
        if (manifest.sourceType === 'official-wards') {
            const wardId = normalizeIdentity(feature.properties?.[identity.wardIdField]);
            if (!wardId) throw new Error('Ward feature is missing its configured ward ID');
            if (wardIds.has(wardId)) throw new Error(`Duplicate ward ID "${wardId}" in source data`);
            wardIds.add(wardId);
        }
        return validateFeatureGeometry(feature, sourceCrs);
    });
    if (manifest.sourceType === 'official-wards' && geometries.length < 2) {
        throw new Error('Ward boundary sources must contain at least two identified ward features');
    }
    if (
        manifest.sourceType === 'official-wards' &&
        geometries.length !== manifest.expectedFeatureCount
    ) {
        throw new Error(
            `Ward source has ${geometries.length} features; expected ${manifest.expectedFeatureCount}`,
        );
    }

    const boundary = mergeBoundaryFeatures(geometries);
    if (!booleanValid({ type: 'Feature', properties: {}, geometry: boundary })) {
        throw new Error('Merged city boundary has invalid polygon topology');
    }
    const [longitude, latitude] = CITY_BOUNDARY_REFERENCE_POINTS[city.id];
    if (!isPointInsideCity(latitude, longitude, boundary)) {
        throw new Error(`Merged boundary does not cover the reference location for ${city.name}`);
    }

    return {
        city,
        geometry: boundary,
        metadata: {
            sourceType: manifest.sourceType,
            boundaryType: manifest.boundaryType,
            sourceName: manifest.sourceName.trim(),
            sourceUrl: manifest.sourceUrl.trim(),
            sourceId: manifest.sourceId.trim(),
            retrievedAt,
            license: manifest.license.trim(),
            licenseUrl: manifest.licenseUrl.trim(),
            verificationStatus: manifest.verificationStatus,
            verificationNotes: manifest.verificationNotes.trim(),
            coordinateReferenceSystem: 'EPSG:4326',
            featureCount: features.length,
            identity: manifest.identity || null,
        },
    };
};

export const getBoundarySourcePriority = (cityDocument) => {
    if (cityDocument?.osmBoundaryId) return CITY_BOUNDARY_SOURCE_PRIORITY.osm;
    const sourceType = cityDocument?.boundaryMetadata?.sourceType;
    return CITY_BOUNDARY_SOURCE_PRIORITY[sourceType] ?? Number.POSITIVE_INFINITY;
};

export const canReplaceBoundary = (currentCity, incomingMetadata, { replace = false } = {}) => {
    const currentPriority = getBoundarySourcePriority(currentCity);
    const incomingPriority = CITY_BOUNDARY_SOURCE_PRIORITY[incomingMetadata.sourceType];
    if (!Number.isFinite(incomingPriority)) throw new Error('Incoming boundary source has no configured priority');
    if (currentPriority < incomingPriority) {
        return { allowed: false, reason: 'A higher-priority boundary is already stored' };
    }
    if (
        currentPriority === incomingPriority &&
        currentCity?.boundaryMetadata?.sourceId !== incomingMetadata.sourceId &&
        !replace
    ) {
        return { allowed: false, reason: 'A boundary at this source priority is already stored; explicit replacement is required' };
    }
    return { allowed: true };
};

export const persistCityBoundary = async (
    normalizedBoundary,
    { replace = false, cityModel = City } = {},
) => {
    const { city, geometry, metadata } = normalizedBoundary;
    const currentCity = await cityModel.findOne({ cityId: city.id })
        .select('osmBoundaryId boundaryMetadata')
        .lean();
    const replacement = canReplaceBoundary(currentCity, metadata, { replace });
    if (!replacement.allowed) {
        return { stored: false, reason: replacement.reason };
    }

    await cityModel.updateOne(
        { cityId: city.id },
        {
            $set: {
                cityId: city.id,
                name: city.name,
                state: city.state,
                country: city.country,
                timezone: city.timezone,
                boundary: geometry,
                boundarySource: metadata.sourceName,
                boundaryMetadata: metadata,
                boundaryUpdatedAt: metadata.retrievedAt,
            },
            $setOnInsert: { featureCount: 0 },
        },
        { upsert: true, runValidators: true },
    );
    return { stored: true };
};
