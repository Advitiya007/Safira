import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreRouteSegments } from '../src/services/routeScoringService.js';
import { recommendRoute } from '../src/services/routeRecommendationService.js';

const makeSegment = (index = 0, start = [28.6, 77.2], end = [28.6009, 77.2]) => ({
    index,
    start,
    end,
    center: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    distanceMeters: 100,
    startDistanceMeters: index * 100,
    endDistanceMeters: (index + 1) * 100,
    estimatedArrival: new Date('2025-01-06T04:30:00.000Z'),
});

const options = {
    mode: 'walking',
    timezone: 'Asia/Kolkata',
    searchRadiusMeters: 125,
    emergencySearchRadiusMeters: 1000,
    osmDataTimestamp: new Date('2025-01-06T00:00:00.000Z'),
    now: new Date('2025-01-06T00:00:00.000Z'),
};

const roadFeature = (id, segment) => ({
    osmType: 'way',
    osmId: id,
    geometry: {
        type: 'LineString',
        coordinates: [
            [segment.start[1] - 0.0002, segment.center[0]],
            [segment.end[1] + 0.0002, segment.center[0]],
        ],
    },
    tags: { highway: 'residential', lit: 'yes' },
});

test('a nearby hospital contributes an actual distance-based emergency indicator', () => {
    const segment = makeSegment();
    const hospital = {
        osmType: 'node',
        osmId: 'hospital-nearby',
        geometry: { type: 'Point', coordinates: [77.2, 28.6045] },
        tags: { amenity: 'hospital', name: 'Mapped hospital' },
    };
    const withHospital = scoreRouteSegments([segment], [hospital], options);
    const withoutHospital = scoreRouteSegments([segment], [], options);

    assert.equal(withHospital.emergencyFacilityCount, 1);
    assert.ok(withHospital.nearestEmergencyFacilityMeters > 300);
    assert.ok(withHospital.nearestEmergencyFacilityMeters < 500);
    assert.ok(withHospital.indicators.emergencyAccess.score > 0);
    assert.equal(withoutHospital.indicators.emergencyAccess.score, null);
});

test('a higher raw score with very low confidence is not recommended over supported evidence', () => {
    const decision = recommendRoute([
        {
            score: 40,
            confidence: 45,
            durationSeconds: 100,
            indicators: {
                lighting: { score: 50, coveragePercent: 100 },
                emergencyAccess: { score: 60, coveragePercent: 100 },
            },
        },
        {
            score: 90,
            confidence: 10,
            durationSeconds: 80,
            indicators: {
                lighting: { score: 100, coveragePercent: 10 },
                emergencyAccess: { score: null, coveragePercent: 0 },
            },
        },
    ]);

    assert.equal(decision.recommendedRouteIndex, 0);
    assert.match(decision.rankingReasons[0], /Recommended over Route 2/);
    assert.match(decision.rankingReasons[0], /lighting is lower/);
    assert.match(decision.rankingReasons[1], /below the 35% threshold/);
});

test('unmapped CCTV remains unknown and cannot inflate a sparse route score', () => {
    const segment = makeSegment();
    const result = scoreRouteSegments([segment], [roadFeature('lit-road', segment)], options);

    assert.equal(result.indicators.cctv.score, null);
    assert.equal(result.indicators.cctv.coveragePercent, 0);
    assert.equal(result.indicators.lighting.score, 100);
    assert.equal(result.score, 29);
});

test('a route with only mapped roads cannot receive a high score or recommendation', () => {
    const segment = makeSegment();
    const result = scoreRouteSegments([segment], [roadFeature('only-road', segment)], options);
    const decision = recommendRoute([{
        score: result.score,
        confidence: result.confidence,
        durationSeconds: 100,
        indicators: result.indicators,
    }]);

    assert.equal(result.score, 29);
    assert.ok(result.confidence < 35);
    assert.equal(decision.recommendedRouteIndex, null);
});

test('a long stretch without mapped establishments is reflected in isolation and route details', () => {
    const segments = Array.from({ length: 10 }, (_, index) => {
        const start = [28.6 + index * 0.0009, 77.2];
        const end = [start[0] + 0.0009, 77.2];
        return makeSegment(index, start, end);
    });
    const first = segments[0];
    const cafe = {
        osmType: 'node',
        osmId: 'single-cafe',
        geometry: { type: 'Point', coordinates: [77.2, first.center[0]] },
        tags: { amenity: 'cafe', opening_hours: '24/7' },
    };
    const result = scoreRouteSegments(segments, [cafe], options);

    assert.ok(result.longestMappedActivityGapMeters >= 700);
    assert.ok(result.indicators.isolation.score < 30);
    assert.ok(result.explanations.some((text) => text.includes('Longest stretch without a mapped establishment')));
});

test('no route is recommended when all routes have insufficient data confidence', () => {
    const decision = recommendRoute([
        { score: 85, confidence: 10, durationSeconds: 100 },
        { score: 60, confidence: 18, durationSeconds: 120 },
        { score: null, confidence: 0, durationSeconds: 90 },
    ]);

    assert.equal(decision.recommendedRouteIndex, null);
    assert.equal(decision.recommendationStatus, 'insufficient_data');
    assert.match(decision.recommendationMessage, /Insufficient data to confidently recommend a route/);
});
