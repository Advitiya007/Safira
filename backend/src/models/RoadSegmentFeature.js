import mongoose from 'mongoose';

// Collection written by the Python ML service (ml_service/safira_ml/store.py).
// This model is READ-ONLY from the Node side: it documents the shape and lets the backend
// report coverage. Indexes are created by the Python service (`ensure_indexes`), so
// autoIndex is disabled here to keep a single owner and avoid startup side effects.
//
// A feature value of `null` means "unknown / no mapped data to measure from"; it is NOT zero.
const roadSegmentFeatureSchema = new mongoose.Schema({
    cityId: { type: String, required: true, enum: ['jalandhar', 'bathinda', 'delhi'] },
    segmentKey: { type: String, required: true },
    osmWayId: { type: String },
    roadType: { type: String },
    roadGroup: { type: String },
    geometry: { type: mongoose.Schema.Types.Mixed, required: true },
    midpoint: { type: mongoose.Schema.Types.Mixed },
    features: { type: mongoose.Schema.Types.Mixed, default: {} },
    informational: { type: mongoose.Schema.Types.Mixed, default: {} },
    flags: {
        isShort: Boolean,
        nearBboxEdge: Boolean,
        bboxEdgeDistanceMeters: Number,
    },
    extraction: { type: mongoose.Schema.Types.Mixed },
    modelAssignment: {
        type: new mongoose.Schema({
            scope: String,
            modelVersion: String,
            clusterId: Number,
            clusterName: String,
            distanceToCentroid: Number,
            atypical: Boolean,
            imputedFeatures: [String],
            assignedAt: Date,
        }, { _id: false }),
        default: null,
    },
}, { collection: 'roadsegmentfeatures', autoIndex: false, timestamps: false });

export default mongoose.models.RoadSegmentFeature ||
    mongoose.model('RoadSegmentFeature', roadSegmentFeatureSchema);
