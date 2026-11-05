import mongoose from 'mongoose';

const geographicFeatureSchema = new mongoose.Schema({
    cityId: {
        type: String,
        required: true,
        enum: ['jalandhar', 'bathinda', 'delhi'],
    },
    osmType: { type: String, required: true, enum: ['node', 'way', 'relation'] },
    osmId: { type: String, required: true },
    geometry: {
        type: { type: String, required: true },
        coordinates: { type: mongoose.Schema.Types.Mixed, required: true },
    },
    tags: { type: mongoose.Schema.Types.Mixed, required: true, default: {} },
    featureCategories: [{ type: String, index: true }],
    source: { type: String, required: true, default: 'OpenStreetMap' },
    sourceTimestamp: { type: Date },
    importedAt: { type: Date, required: true, default: Date.now },
    dataVersion: { type: String },
    importRunId: { type: String },
}, { timestamps: true });

geographicFeatureSchema.index(
    { cityId: 1, osmType: 1, osmId: 1 },
    { unique: true },
);
geographicFeatureSchema.index({ cityId: 1, geometry: '2dsphere' });
geographicFeatureSchema.index({ cityId: 1, featureCategories: 1 });

export default mongoose.models.GeographicFeature ||
    mongoose.model('GeographicFeature', geographicFeatureSchema);
