import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { normalizeCityBoundarySource, persistCityBoundary } from '../services/cityBoundaryImportService.js';

const argumentsList = process.argv.slice(2);
const getArgument = (name) => argumentsList
    .find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const main = async () => {
    const cityId = getArgument('--city');
    const filePath = getArgument('--file');
    const manifestPath = getArgument('--manifest');
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required to import a city boundary');
    if (!cityId || !filePath || !manifestPath) {
        throw new Error(
            'Usage: npm run import:boundary -- --city=jalandhar --file=wards.geojson --manifest=boundary-manifest.json',
        );
    }

    await mongoose.connect(process.env.MONGO_URI);
    const [geoJson, manifest] = await Promise.all([
        fs.readFile(path.resolve(filePath), 'utf8').then(JSON.parse),
        fs.readFile(path.resolve(manifestPath), 'utf8').then(JSON.parse),
    ]);
    const normalized = normalizeCityBoundarySource(cityId, geoJson, manifest);
    const result = await persistCityBoundary(normalized, { replace: argumentsList.includes('--replace') });
    if (!result.stored) throw new Error(`Boundary was not saved for ${cityId}: ${result.reason}`);
    console.log(
        `Stored ${cityId} boundary from ${normalized.metadata.sourceName} ` +
        `(${normalized.metadata.sourceType}); ${normalized.metadata.featureCount} source feature(s), ` +
        `verified=${normalized.metadata.verificationStatus}`,
    );
};

main()
    .catch((error) => {
        console.error('City boundary import failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
