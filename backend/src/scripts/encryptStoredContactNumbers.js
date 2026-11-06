import 'dotenv/config';
import mongoose from 'mongoose';
import { migrateStoredContactNumbers } from '../services/contactMigrationService.js';

const main = async () => {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI must be configured before migrating contact numbers');
    await mongoose.connect(uri);
    const { usersUpdated, guardiansUpdated } = await migrateStoredContactNumbers();
    console.log(`Encrypted contact fields for ${usersUpdated} user record(s) and ${guardiansUpdated} guardian record(s).`);
};

main()
    .catch((error) => {
        console.error(`Contact-number migration failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (mongoose.connection.readyState) await mongoose.disconnect();
    });
