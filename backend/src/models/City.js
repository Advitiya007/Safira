import mongoose from 'mongoose';
import { SUPPORTED_CITIES } from '../config/safeRouteConfig.js';

const citySchema = new mongoose.Schema({
    cityId: {
        type: String,
        required: true,
        unique: true,
        enum: SUPPORTED_CITIES.map((city) => city.id),
    },
    name: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, required: true },
    timezone: { type: String, required: true },
    boundary: {
        type: { type: String, enum: ['Polygon', 'MultiPolygon'] },
        coordinates: { type: mongoose.Schema.Types.Mixed },
    },
    boundarySource: { type: String, default: 'OpenStreetMap' },
    osmBoundaryName: { type: String },
    osmBoundaryType: { type: String, enum: ['relation', 'way'] },
    osmBoundaryId: { type: String },
    osmAdminLevel: { type: String },
    boundaryMetadata: {
        sourceType: {
            type: String,
            enum: ['osm', 'official-municipal', 'official-wards', 'other-administrative', 'prototype-study-area'],
        },
        boundaryType: { type: String },
        sourceName: { type: String },
        sourceUrl: { type: String },
        sourceId: { type: String },
        retrievedAt: { type: Date },
        license: { type: String },
        licenseUrl: { type: String },
        verificationStatus: { type: String, enum: ['verified', 'prototype'] },
        verificationNotes: { type: String },
        coordinateReferenceSystem: { type: String },
        featureCount: { type: Number },
        identity: { type: mongoose.Schema.Types.Mixed },
    },
    boundaryUpdatedAt: { type: Date },
    dataImportedAt: { type: Date },
    osmDataTimestamp: { type: Date },
    featureImportStatus: {
        type: String,
        enum: ['pending', 'importing', 'imported', 'failed'],
        default: 'pending',
    },
    featureImportSource: { type: String },
    featureImportMessage: { type: String },
    latestImportRunId: { type: String },
    featureCount: { type: Number, default: 0 },
    coverage: {
        roads: { type: Number, default: 0 },
        activity: { type: Number, default: 0 },
        lighting: { type: Number, default: 0 },
        surveillance: { type: Number, default: 0 },
        emergency: { type: Number, default: 0 },
        publicTransport: { type: Number, default: 0 },
    },
}, { timestamps: true });

citySchema.index({ boundary: '2dsphere' });

export default mongoose.models.City || mongoose.model('City', citySchema);
