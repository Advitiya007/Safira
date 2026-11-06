import mongoose from 'mongoose';
import { ROUTE_ANALYSIS_TTL_SECONDS, ROUTE_SCORING_VERSION } from '../config/safeRouteConfig.js';

const routeAnalysisSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cityId: { type: String, required: true, enum: ['jalandhar', 'bathinda', 'delhi'] },
    mode: { type: String, required: true, enum: ['walking', 'driving'] },
    scoringWeights: { type: mongoose.Schema.Types.Mixed },
    departureTime: { type: Date, required: true },
    origin: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true },
    },
    destination: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true },
    },
    routes: [{
        id: Number,
        geometry: {
            type: { type: String, enum: ['LineString'] },
            coordinates: { type: [[Number]] },
        },
        distanceMeters: Number,
        durationSeconds: Number,
        score: Number,
        confidence: Number,
        scoredSegmentCoveragePercent: Number,
        longestMappedActivityGapMeters: Number,
        mappedFeatureCount: Number,
        indicators: { type: mongoose.Schema.Types.Mixed },
        indicatorCoverage: { type: mongoose.Schema.Types.Mixed },
        emergencyFacilityCount: Number,
        nearestEmergencyFacilityMeters: Number,
        explanations: [String],
        rankingReason: String,
        facilities: [{ type: mongoose.Schema.Types.Mixed }],
        segments: [{ type: mongoose.Schema.Types.Mixed }],
    }],
    recommendedRouteIndex: { type: Number, default: null },
    recommendationStatus: { type: String, enum: ['recommended', 'insufficient_data'], default: 'insufficient_data' },
    recommendationMessage: { type: String },
    minimumRecommendationConfidence: { type: Number },
    algorithmVersion: { type: Number, required: true, default: ROUTE_SCORING_VERSION },
    osmDataTimestamp: { type: Date },
    dataCoverage: { type: mongoose.Schema.Types.Mixed },
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + ROUTE_ANALYSIS_TTL_SECONDS * 1000),
        expires: 0,
    },
}, { timestamps: true });

export default mongoose.models.RouteAnalysis ||
    mongoose.model('RouteAnalysis', routeAnalysisSchema);
