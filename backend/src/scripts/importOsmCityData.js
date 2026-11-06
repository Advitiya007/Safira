import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import mongoose from 'mongoose';
import City from '../models/City.js';
import {
    CITY_BOUNDARY_SOURCE_PRIORITY,
    SUPPORTED_CITIES,
} from '../config/safeRouteConfig.js';
import { seedOsmCityBoundaries } from '../services/osmCityBoundaryService.js';
import {
    fetchCityOverpassResponse,
    validateCityBoundingBox,
} from '../services/osmBoundingBoxImportService.js';
import { runGeographicImport } from '../services/geographicImportService.js';
import {
    canReplaceBoundary,
    normalizeCityBoundarySource,
    persistCityBoundary,
} from '../services/cityBoundaryImportService.js';

const DATA_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

const hasStoredCityBoundary = async (cityId) => {
    const existing = await City.findOne({ cityId })
        .select('boundary osmBoundaryId boundaryMetadata')
        .lean();
    return Boolean(existing?.boundary?.type && (
        existing.osmBoundaryId ||
        ['verified', 'prototype'].includes(existing.boundaryMetadata?.verificationStatus)
    ));
};

const seedCityBoundaries = async () => {
    const outcomes = await seedOsmCityBoundaries({
        saveBoundary: async (city, boundary) => City.updateOne(
            { cityId: city.id },
            {
                $set: {
                    cityId: city.id,
                    ...city,
                    boundary: boundary.geometry,
                    boundarySource: boundary.source,
                    osmBoundaryName: boundary.boundaryName,
                    osmBoundaryType: boundary.osmType,
                    osmBoundaryId: boundary.osmId,
                    osmAdminLevel: boundary.adminLevel,
                    boundaryUpdatedAt: boundary.retrievedAt,
                    boundaryMetadata: {
                        sourceType: 'osm',
                        boundaryType: 'city-administrative-relation',
                        sourceName: 'OpenStreetMap',
                        sourceUrl: boundary.sourceUrl,
                        sourceId: `${boundary.osmType}/${boundary.osmId}`,
                        retrievedAt: boundary.retrievedAt,
                        license: 'Open Database License 1.0 (ODbL)',
                        licenseUrl: 'https://www.openstreetmap.org/copyright',
                        verificationStatus: 'verified',
                        verificationNotes: 'OSM administrative city boundary; raw element tags and complete polygon geometry were verified.',
                        coordinateReferenceSystem: 'EPSG:4326',
                        featureCount: 1,
                    },
                },
                $setOnInsert: { featureCount: 0 },
            },
            { upsert: true, runValidators: true },
        ),
        writeBoundaryFile: (city, boundary) => {
            fs.mkdirSync(path.join(DATA_DIRECTORY, 'city-boundaries'), { recursive: true });
            fs.writeFileSync(
                path.join(DATA_DIRECTORY, 'city-boundaries', `${city.id}.geojson`),
                JSON.stringify({
                    type: 'Feature',
                    properties: {
                        cityId: city.id,
                        source: boundary.source,
                        osmType: boundary.osmType,
                        osmId: boundary.osmId,
                        boundaryName: boundary.boundaryName,
                        adminLevel: boundary.adminLevel,
                        retrievedAt: boundary.retrievedAt,
                    },
                    geometry: boundary.geometry,
                }),
            );
        },
    });
    const outcomeByCity = new Map(outcomes.map((outcome) => [outcome.cityId, outcome]));
    let unresolved = false;

    for (const city of SUPPORTED_CITIES) {
        if (outcomeByCity.get(city.id)?.status === 'stored') continue;
        const sourceDirectory = path.join(DATA_DIRECTORY, 'boundary-sources', city.id);
        if (!fs.existsSync(sourceDirectory)) {
            console.warn(
                `No configured external boundary sources for ${city.name}; ` +
                'provide a verified GeoJSON source manifest before seeding this city',
            );
            if (!await hasStoredCityBoundary(city.id)) unresolved = true;
            continue;
        }

        const manifestFiles = fs.readdirSync(sourceDirectory)
            .filter((file) => file.endsWith('.manifest.json'));
        const sourceCandidates = [];
        for (const manifestFile of manifestFiles) {
            const manifestPath = path.join(sourceDirectory, manifestFile);
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                const dataFile = manifest.file;
                if (
                    typeof dataFile !== 'string' ||
                    path.basename(dataFile) !== dataFile ||
                    !dataFile.toLowerCase().endsWith('.geojson')
                ) {
                    throw new Error('manifest.file must be a local .geojson filename');
                }
                sourceCandidates.push({ manifest, manifestPath, dataPath: path.join(sourceDirectory, dataFile) });
            } catch (error) {
                console.error(`Invalid boundary source manifest ${manifestPath}: ${error.message}`);
            }
        }
        if (!sourceCandidates.length) {
            console.warn(`No usable external boundary manifests found for ${city.name}`);
        }
        sourceCandidates.sort((first, second) => (
            (CITY_BOUNDARY_SOURCE_PRIORITY[first.manifest.sourceType] ?? Number.POSITIVE_INFINITY) -
            (CITY_BOUNDARY_SOURCE_PRIORITY[second.manifest.sourceType] ?? Number.POSITIVE_INFINITY)
        ));

        let citySeeded = false;
        for (const source of sourceCandidates) {
            try {
                const geoJson = JSON.parse(fs.readFileSync(source.dataPath, 'utf8'));
                const normalized = normalizeCityBoundarySource(city.id, geoJson, source.manifest);
                const current = await City.findOne({ cityId: city.id })
                    .select('osmBoundaryId boundaryMetadata')
                    .lean();
                const replacement = canReplaceBoundary(current, normalized.metadata);
                if (!replacement.allowed) {
                    console.warn(`Skipped ${source.manifest.sourceName} for ${city.name}: ${replacement.reason}`);
                    continue;
                }
                const result = await persistCityBoundary(normalized);
                if (!result.stored) {
                    console.warn(`Skipped ${source.manifest.sourceName} for ${city.name}: ${result.reason}`);
                    continue;
                }
                const outputDirectory = path.join(DATA_DIRECTORY, 'city-boundaries');
                fs.mkdirSync(outputDirectory, { recursive: true });
                fs.writeFileSync(
                    path.join(outputDirectory, `${city.id}.geojson`),
                    JSON.stringify({
                        type: 'Feature',
                        properties: normalized.metadata,
                        geometry: normalized.geometry,
                    }),
                );
                console.log(
                    `Stored ${city.name} ${normalized.metadata.verificationStatus} boundary from ` +
                    `${normalized.metadata.sourceName} (${normalized.metadata.sourceType})`,
                );
                citySeeded = true;
                break;
            } catch (error) {
                console.error(`Boundary source ${source.manifestPath} rejected for ${city.name}: ${error.message}`);
            }
        }
        if (!citySeeded) {
            citySeeded = await hasStoredCityBoundary(city.id);
        }
        if (!citySeeded) unresolved = true;
    }

    if (unresolved) process.exitCode = 1;
};

const readGeoJsonSequence = async function* (filePath) {
    const input = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity,
    });
    for await (const line of input) {
        if (!line.trim()) continue;
        try {
            yield JSON.parse(line);
        } catch {
            yield null;
        }
    }
};

const argumentsList = process.argv.slice(2);
const getArgument = (name) => argumentsList.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const main = async () => {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required to import OSM data');
    await mongoose.connect(process.env.MONGO_URI);

    if (argumentsList.includes('--seed-boundaries')) {
        await seedCityBoundaries();
        return;
    }

    const cityId = getArgument('--city');
    const filePath = getArgument('--file');
    const fetchOverpass = argumentsList.includes('--fetch');
    const resume = argumentsList.includes('--resume');
    const fresh = argumentsList.includes('--fresh');
    const recoverStaleRunId = getArgument('--recover-stale-run');
    const hasSingleSource = Number(Boolean(filePath)) + Number(fetchOverpass) + Number(resume) === 1;
    if (
        !SUPPORTED_CITIES.some((city) => city.id === cityId) ||
        !hasSingleSource ||
        (fresh && resume) ||
        (recoverStaleRunId && (!fetchOverpass || resume))
    ) {
        throw new Error(
            'Usage: npm run import:osm -- --city=jalandhar --fetch [--fresh] [--recover-stale-run=ID] OR ' +
            '--city=jalandhar --file=city.geojsonl [--fresh] [--data-version=VERSION] OR ' +
            '--city=jalandhar --resume [--run-id=ID] (or --seed-boundaries)',
        );
    }
    validateCityBoundingBox(cityId);
    const mode = fresh ? 'fresh' : 'incremental';
    const cacheDirectory = path.join(DATA_DIRECTORY, 'osm-import-cache');
    if (fetchOverpass) {
        await runGeographicImport({
            cityId,
            mode,
            source: 'Overpass API',
            cacheDirectory,
            dataVersion: getArgument('--data-version'),
            recoverStaleRunId,
            fetchRaw: () => fetchCityOverpassResponse(cityId),
        });
        return;
    }
    if (filePath) {
        await runGeographicImport({
            cityId,
            mode,
            source: 'OSM PBF GeoJSONL',
            cacheDirectory,
            dataVersion: getArgument('--data-version'),
            features: readGeoJsonSequence(filePath),
        });
        return;
    }
    await runGeographicImport({
        cityId,
        resume: true,
        runId: getArgument('--run-id'),
        cacheDirectory,
    });
};

main()
    .catch((error) => {
        console.error('OSM import failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
