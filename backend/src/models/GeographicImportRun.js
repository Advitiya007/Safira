import mongoose from 'mongoose';
import { SUPPORTED_CITIES } from '../config/safeRouteConfig.js';

const geographicImportRunSchema = new mongoose.Schema({
    cityId: {
        type: String,
        required: true,
        enum: SUPPORTED_CITIES.map(({ id }) => id),
    },
    status: {
        type: String,
        required: true,
        enum: ['running', 'completed', 'failed', 'interrupted'],
        default: 'running',
    },
    mode: { type: String, required: true, enum: ['incremental', 'fresh'] },
    source: { type: String, required: true },
    startedAt: { type: Date, required: true, default: Date.now },
    completedAt: { type: Date },
    leaseUntil: { type: Date },
    rawCachePath: { type: String },
    rawCacheAvailable: { type: Boolean, default: false },
    dataVersion: { type: String },
    counts: {
        fetchedElements: { type: Number, default: 0 },
        normalizedFeatures: { type: Number, default: 0 },
        skippedFeatures: { type: Number, default: 0 },
        invalidFeatures: { type: Number, default: 0 },
        upsertedFeatures: { type: Number, default: 0 },
        modifiedFeatures: { type: Number, default: 0 },
        deletedFeatures: { type: Number, default: 0 },
        totalFeatures: { type: Number, default: 0 },
        categories: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    error: {
        message: { type: String },
        statusCode: { type: Number },
    },
}, { timestamps: true });

geographicImportRunSchema.index(
    { cityId: 1 },
    { unique: true, partialFilterExpression: { status: 'running' } },
);
geographicImportRunSchema.index({ cityId: 1, startedAt: -1 });

export default mongoose.models.GeographicImportRun ||
    mongoose.model('GeographicImportRun', geographicImportRunSchema);
