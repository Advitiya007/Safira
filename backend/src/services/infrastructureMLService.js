import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mlModelData = null;

const loadModelData = () => {
    if (!mlModelData) {
        try {
            const raw = readFileSync(join(__dirname, '../config/mlClusterModel.json'), 'utf-8');
            mlModelData = JSON.parse(raw);
        } catch (error) {
            console.warn('Could not load ML cluster model JSON:', error.message);
            return null;
        }
    }
    return mlModelData;
};

/**
 * Predicts the infrastructure cluster for a single feature vector.
 */
export const predictCluster = (features) => {
    const model = loadModelData();
    if (!model) return null;

    const { cluster_centers, scaler_mean, scaler_scale, profiles } = model;
    
    // Feature vector order matching NUMERICAL_FEATURES
    const rawVector = [
        features.road_length_m ?? 150.0,
        Math.log1p(features.police_count_1km ?? 0),
        Math.min(features.nearest_police_dist_m ?? 2500, 2500) / 2500.0,
        Math.log1p(features.hospital_count_1km ?? 0),
        Math.min(features.nearest_hospital_dist_m ?? 2500, 2500) / 2500.0,
        Math.log1p(features.pharmacy_count_500m ?? 0),
        Math.min(features.nearest_pharmacy_dist_m ?? 2500, 2500) / 2500.0,
        Math.log1p(features.shop_count_250m ?? 0),
        Math.log1p(features.establishment_density_sqkm ?? 0),
        Math.log1p(features.transit_count_500m ?? 0),
        Math.min(features.nearest_transit_dist_m ?? 2500, 2500) / 2500.0,
        Math.log1p(features.lighting_signals_count ?? 0),
        features.road_accessibility_score ?? 70.0,
    ];

    // Standardize
    const scaled = rawVector.map((val, idx) => (val - scaler_mean[idx]) / (scaler_scale[idx] || 1.0));

    // Find nearest cluster centroid
    let bestCluster = 0;
    let minDistanceSq = Infinity;

    for (let c = 0; c < cluster_centers.length; c++) {
        const center = cluster_centers[c];
        let distSq = 0;
        for (let i = 0; i < scaled.length; i++) {
            const diff = scaled[i] - center[i];
            distSq += diff * diff;
        }
        if (distSq < minDistanceSq) {
            minDistanceSq = distSq;
            bestCluster = c;
        }
    }

    const profile = profiles[String(bestCluster)] || {};
    return {
        clusterId: bestCluster,
        archetype: profile.archetype_name || 'Urban Road Segment',
        description: profile.description || 'General infrastructure profile',
    };
};

/**
 * Profiles an entire route by classifying its segments and aggregating archetype coverage.
 */
export const profileRouteInfrastructure = (routeSegments = []) => {
    const model = loadModelData();
    if (!model || !routeSegments.length) {
        return null;
    }

    const clusterCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const segmentsWithCluster = routeSegments.map((segment) => {
        const evidence = segment.evidence || {};
        const indicators = segment.indicators || {};
        
        const prediction = predictCluster({
            road_length_m: segment.distanceMeters || 150,
            police_count_1km: evidence.policeCount || 0,
            nearest_police_dist_m: evidence.nearestPoliceMeters || (evidence.policeCount ? 400 : 2500),
            hospital_count_1km: evidence.hospitalCount || 0,
            nearest_hospital_dist_m: evidence.nearestHospitalMeters || (evidence.hospitalCount ? 350 : 2500),
            pharmacy_count_500m: evidence.pharmacyCount || 0,
            nearest_pharmacy_dist_m: evidence.nearestPharmacyMeters || (evidence.pharmacyCount ? 250 : 2500),
            shop_count_250m: evidence.openEstablishmentCount || evidence.mappedActivityCount || 0,
            establishment_density_sqkm: ((evidence.mappedActivityCount || 0) / 0.1963),
            transit_count_500m: evidence.publicTransportCount || 0,
            nearest_transit_dist_m: evidence.nearestTransitMeters || (evidence.publicTransportCount ? 200 : 2500),
            lighting_signals_count: evidence.streetLampCount || 0,
            road_accessibility_score: indicators.roadAccessibility ?? 75,
        });

        if (prediction) {
            clusterCounts[prediction.clusterId] = (clusterCounts[prediction.clusterId] || 0) + 1;
        }
        return {
            ...segment,
            mlClusterId: prediction?.clusterId ?? null,
            mlArchetype: prediction?.archetype ?? null,
        };
    });

    const total = routeSegments.length || 1;
    // Find dominant cluster along route
    let dominantCluster = 0;
    let maxCount = -1;
    for (let c = 0; c < 4; c++) {
        if (clusterCounts[c] > maxCount) {
            maxCount = clusterCounts[c];
            dominantCluster = c;
        }
    }

    const dominantProfile = model.profiles[String(dominantCluster)] || {};

    return {
        dominantClusterId: dominantCluster,
        archetype: dominantProfile.archetype_name || 'Standard Urban Connector',
        description: dominantProfile.description || '',
        breakdown: {
            peripheralPercent: Math.round((clusterCounts[0] / total) * 100),
            residentialPercent: Math.round((clusterCounts[1] / total) * 100),
            civicCorePercent: Math.round((clusterCounts[2] / total) * 100),
            commercialHubPercent: Math.round((clusterCounts[3] / total) * 100),
        },
        classifiedSegments: segmentsWithCluster,
    };
};
