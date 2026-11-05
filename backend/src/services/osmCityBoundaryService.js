import { OSM_CITY_BOUNDARY_SEARCH_NAMES, SUPPORTED_CITIES } from '../config/safeRouteConfig.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OSM_API_URL = 'https://api.openstreetmap.org/api/0.6';
const CITY_ADDRESS_TYPES = new Set(['city', 'municipality']);

const normalizeName = (value) => String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();

const getCandidateNames = (candidate) => {
    const names = [candidate.name];
    for (const [key, value] of Object.entries(candidate.namedetails || {})) {
        if (/^(name|official_name|alt_name|short_name|loc_name|old_name)(:|$)/i.test(key)) {
            names.push(...String(value).split(';'));
        }
    }
    for (const key of ['alt_name', 'official_name', 'short_name', 'loc_name', 'old_name']) {
        names.push(...String(candidate.extratags?.[key] || '').split(';'));
    }
    return names.map(normalizeName).filter(Boolean);
};

const isNameMatch = (candidate, names) => {
    const candidateNames = new Set(getCandidateNames(candidate));
    return names.some((name) => candidateNames.has(normalizeName(name)));
};

const isBoundaryElement = (candidate) => (
    (candidate.category === 'boundary' || candidate.class === 'boundary') &&
    candidate.type === 'administrative' &&
    ['relation', 'way'].includes(candidate.osm_type)
);

const isInCityRegion = (candidate, city) => {
    const address = candidate.address || {};
    if (address.country && normalizeName(address.country) !== normalizeName(city.country)) return false;
    if (address.state && normalizeName(address.state) !== normalizeName(city.state)) return false;
    return true;
};

const isCityAddressType = (candidate) => (
    CITY_ADDRESS_TYPES.has(normalizeName(candidate.addresstype))
);

const isValidPosition = (position) => (
    Array.isArray(position) &&
    position.length >= 2 &&
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1]) &&
    position[0] >= -180 && position[0] <= 180 &&
    position[1] >= -90 && position[1] <= 90
);

const isClosedRing = (ring) => {
    if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isValidPosition)) return false;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.abs(first[0] - last[0]) > 1e-8 || Math.abs(first[1] - last[1]) > 1e-8) return false;

    const area = ring.slice(0, -1).reduce((sum, point, index, points) => {
        const next = points[(index + 1) % points.length];
        return sum + point[0] * next[1] - next[0] * point[1];
    }, 0);
    return Math.abs(area) > 1e-12;
};

export const isValidBoundaryGeometry = (geometry) => {
    if (geometry?.type === 'Polygon') {
        return Array.isArray(geometry.coordinates) &&
            geometry.coordinates.length > 0 &&
            geometry.coordinates.every(isClosedRing);
    }
    if (geometry?.type === 'MultiPolygon') {
        return Array.isArray(geometry.coordinates) &&
            geometry.coordinates.length > 0 &&
            geometry.coordinates.every((polygon) => (
                Array.isArray(polygon) &&
                polygon.length > 0 &&
                polygon.every(isClosedRing)
            ));
    }
    return false;
};

const hasCityBoundaryIdentity = (candidate, city) => {
    const names = OSM_CITY_BOUNDARY_SEARCH_NAMES[city.id] || [city.name];
    return isBoundaryElement(candidate) &&
        isNameMatch(candidate, names) &&
        isCityAddressType(candidate) &&
        isInCityRegion(candidate, city);
};

const hasAdministrativeLevel = (candidate) => (
    /^\d+(?:\.\d+)?$/.test(String(candidate.extratags?.admin_level || ''))
);

const hasCityBoundaryMetadata = (candidate, city) => (
    hasCityBoundaryIdentity(candidate, city) && hasAdministrativeLevel(candidate)
);

export const isCityBoundaryCandidate = (candidate, city) => (
    hasCityBoundaryMetadata(candidate, city) && isValidBoundaryGeometry(candidate.geojson)
);

const buildSearchUrl = (city, name) => {
    const query = new URLSearchParams({
        q: `${name}, ${city.state}, ${city.country}`,
        format: 'jsonv2',
        addressdetails: '1',
        extratags: '1',
        namedetails: '1',
        limit: '20',
    });
    if (process.env.NOMINATIM_EMAIL) query.set('email', process.env.NOMINATIM_EMAIL);
    return `${NOMINATIM_URL}?${query}`;
};

const buildLookupUrl = (candidate) => {
    const prefix = candidate.osm_type === 'relation' ? 'R' : 'W';
    const query = new URLSearchParams({
        osm_ids: `${prefix}${candidate.osm_id}`,
        format: 'jsonv2',
        addressdetails: '1',
        extratags: '1',
        namedetails: '1',
        polygon_geojson: '1',
    });
    if (process.env.NOMINATIM_EMAIL) query.set('email', process.env.NOMINATIM_EMAIL);
    return `https://nominatim.openstreetmap.org/lookup?${query}`;
};

const buildOsmElementUrl = (candidate) => (
    `${OSM_API_URL}/${candidate.osm_type}/${candidate.osm_id}.json`
);

const requestJson = async (fetcher, url) => {
    const response = await fetcher(url, {
        headers: { 'User-Agent': 'SafeHerIndia/1.0 (OSM city boundary import)' },
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Nominatim returned HTTP ${response.status}`);
    const results = await response.json();
    if (!Array.isArray(results)) throw new Error('Nominatim returned an invalid response');
    return results;
};

const requestOsmElement = async (fetcher, candidate) => {
    const response = await fetcher(buildOsmElementUrl(candidate), {
        headers: { 'User-Agent': 'SafeHerIndia/1.0 (OSM city boundary import)' },
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`OpenStreetMap API returned HTTP ${response.status}`);
    const data = await response.json();
    const element = data.elements?.find((item) => (
        item.type === candidate.osm_type &&
        String(item.id) === String(candidate.osm_id)
    ));
    if (!element) throw new Error('OpenStreetMap API did not return the requested element');
    return element;
};

const isSupportedOsmBoundaryElement = (element, candidate, city) => {
    const tags = element.tags || {};
    const relationTypeSupported = candidate.osm_type !== 'relation' ||
        ['boundary', 'multipolygon'].includes(tags.type);
    const wayIsClosed = candidate.osm_type !== 'way' ||
        (Array.isArray(element.nodes) && element.nodes.length >= 4 &&
            element.nodes[0] === element.nodes[element.nodes.length - 1]);
    const adminLevelMatches = String(tags.admin_level || '') ===
        String(candidate.extratags?.admin_level || '');
    const osmNames = getCandidateNames({
        name: tags.name,
        namedetails: tags,
        extratags: tags,
    });
    const acceptedNames = OSM_CITY_BOUNDARY_SEARCH_NAMES[city.id] || [city.name];

    return tags.boundary === 'administrative' &&
        relationTypeSupported &&
        wayIsClosed &&
        adminLevelMatches &&
        /^\d+(?:\.\d+)?$/.test(String(tags.admin_level || '')) &&
        acceptedNames.some((name) => osmNames.includes(normalizeName(name)));
};

export const findOsmCityBoundary = async ({
    city,
    fetcher = fetch,
}) => {
    const names = OSM_CITY_BOUNDARY_SEARCH_NAMES[city.id] || [city.name];
    const downloadErrors = [];
    const invalidCandidates = [];
    const checkedElements = new Set();

    for (const name of names) {
        try {
            const results = await requestJson(fetcher, buildSearchUrl(city, name));

            for (const candidate of results) {
                if (!hasCityBoundaryIdentity(candidate, city)) continue;
                if (!hasAdministrativeLevel(candidate)) {
                    invalidCandidates.push(`${candidate.osm_type} ${candidate.osm_id} has no valid admin_level`);
                    continue;
                }
                const elementKey = `${candidate.osm_type}/${candidate.osm_id}`;
                if (checkedElements.has(elementKey)) continue;
                checkedElements.add(elementKey);

                try {
                    const details = await requestJson(fetcher, buildLookupUrl(candidate));
                    const boundary = details.find((result) => (
                        result.osm_type === candidate.osm_type &&
                        String(result.osm_id) === String(candidate.osm_id)
                    ));
                    if (!boundary || !isCityBoundaryCandidate(boundary, city)) {
                        invalidCandidates.push(`${elementKey} has missing or invalid polygon geometry/metadata`);
                        continue;
                    }
                    const osmElement = await requestOsmElement(fetcher, boundary);
                    if (!isSupportedOsmBoundaryElement(osmElement, boundary, city)) {
                        invalidCandidates.push(`${elementKey} has unsupported or mismatched OSM boundary tags`);
                        continue;
                    }
                    return { status: 'found', candidate: { ...boundary, osmTags: osmElement.tags } };
                } catch (error) {
                    downloadErrors.push(`${candidate.osm_type} ${candidate.osm_id}: ${error.message}`);
                }
            }
        } catch (error) {
            downloadErrors.push(`${name}: ${error.message}`);
        }
    }

    if (invalidCandidates.length) {
        return { status: 'invalid', errors: [...invalidCandidates, ...downloadErrors] };
    }
    if (downloadErrors.length) return { status: 'download_failed', errors: downloadErrors };
    return { status: 'not_found' };
};

export const seedOsmCityBoundaries = async ({
    cities = SUPPORTED_CITIES,
    fetcher = fetch,
    saveBoundary,
    writeBoundaryFile,
    logger = console,
    delayMs = 1100,
    delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    retrievedAt = () => new Date(),
}) => {
    if (typeof saveBoundary !== 'function') {
        throw new TypeError('saveBoundary must be provided to seed OSM city boundaries');
    }

    const outcomes = [];
    let lastRequestAt = null;
    const rateLimitedFetcher = async (...args) => {
        if (lastRequestAt !== null) {
            const waitMs = delayMs - (Date.now() - lastRequestAt);
            if (waitMs > 0) await delay(waitMs);
        }
        try {
            return await fetcher(...args);
        } finally {
            lastRequestAt = Date.now();
        }
    };

    for (const city of cities) {
        const lookup = await findOsmCityBoundary({ city, fetcher: rateLimitedFetcher });
        if (lookup.status !== 'found') {
            if (lookup.status === 'download_failed') {
                logger.error(`Boundary download failed for ${city.name}: ${lookup.errors.join('; ')}`);
            } else if (lookup.status === 'invalid') {
                logger.error(`Invalid OSM city boundary data for ${city.name}: ${lookup.errors.join('; ')}`);
            } else {
                logger.warn(
                    `No verified OSM city boundary found for ${city.name}; place nodes and district boundaries were excluded`,
                );
            }
            outcomes.push({ cityId: city.id, status: lookup.status });
            continue;
        }

        const { candidate } = lookup;
        const boundary = {
            geometry: candidate.geojson,
            boundaryName: candidate.osmTags.name,
            osmType: candidate.osm_type,
            osmId: String(candidate.osm_id),
            adminLevel: String(candidate.osmTags.admin_level),
            source: 'OpenStreetMap administrative boundary; geometry via Nominatim',
            retrievedAt: retrievedAt(),
            sourceUrl: `https://www.openstreetmap.org/${candidate.osm_type}/${candidate.osm_id}`,
        };

        try {
            await saveBoundary(city, boundary);
        } catch (error) {
            logger.error(`Failed to save OSM boundary for ${city.name} (${boundary.osmType} ${boundary.osmId}): ${error.message}`);
            outcomes.push({ cityId: city.id, status: 'save_failed' });
            continue;
        }

        try {
            if (writeBoundaryFile) await writeBoundaryFile(city, boundary);
        } catch (error) {
            logger.error(`Boundary saved for ${city.name}, but its GeoJSON file could not be written: ${error.message}`);
            outcomes.push({ cityId: city.id, status: 'file_failed', osmId: boundary.osmId });
            continue;
        }

        logger.info(
            `Stored OSM city boundary for ${city.name}: ${boundary.osmType} ${boundary.osmId}, ` +
            `name="${boundary.boundaryName}", admin_level=${boundary.adminLevel}`,
        );
        outcomes.push({ cityId: city.id, status: 'stored', osmId: boundary.osmId });
    }
    return outcomes;
};
