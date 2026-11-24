import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCORE_LABELS, getConfidenceSummary, getRecommendationReview, splitIndicators,
} from '../src/utils/routeCardModel.js';

// Shape copied from a real route-card screenshot: four indicators have no mapped data.
const indicators = {
  nightActivity: { score: null, coveragePercent: 0 },
  lighting: { score: null, coveragePercent: 0 },
  roadAccessibility: { score: 68, coveragePercent: 100 },
  cctv: { score: null, coveragePercent: 0 },
  emergencyAccess: { score: 57, coveragePercent: 84 },
  publicTransport: { score: 19, coveragePercent: 6 },
  isolation: { score: null, coveragePercent: 0 },
};

test('unknown indicators are separated from known ones and never lose a genuine zero', () => {
  const { known, unknown } = splitIndicators({ ...indicators, cctv: { score: 0, coveragePercent: 40 } });
  assert.deepEqual(known.map((item) => item.key), ['roadAccessibility', 'cctv', 'emergencyAccess', 'publicTransport']);
  assert.equal(known.find((item) => item.key === 'cctv').score, 0);       // 0 is data, not "unknown"
  assert.deepEqual(unknown.map((item) => item.label), [
    'night-time activity', 'lighting', 'mapped activity proximity',
  ]);
});

test('missing or malformed indicators do not throw', () => {
  assert.deepEqual(splitIndicators(undefined), { known: [], unknown: [] });
  assert.deepEqual(splitIndicators({ lighting: null }).unknown.map((item) => item.key), ['lighting']);
  assert.ok(SCORE_LABELS.lighting);
});

test('confidence summary reports what is missing and compares with the threshold', () => {
  const summary = getConfidenceSummary({ confidence: 16, indicators, scoredSegmentCoveragePercent: 100 }, 35);
  assert.equal(summary.percent, 16);
  assert.equal(summary.isLow, true);
  assert.equal(summary.knownCount, 3);
  assert.equal(summary.totalCount, 7);
  assert.equal(summary.coveredDistancePercent, 100);
  assert.deepEqual(summary.missingLabels, [
    'night-time activity', 'lighting', 'mapped CCTV', 'mapped activity proximity',
  ]);
  assert.equal(getConfidenceSummary({ confidence: 60, indicators }, 35).isLow, false);
  assert.equal(getConfidenceSummary({ confidence: 35, indicators }, 35).isLow, false);   // threshold is inclusive
  assert.equal(getConfidenceSummary({ indicators }, 35).isLow, false);                   // unknown confidence is not "low"
  assert.equal(getConfidenceSummary({ confidence: 10, indicators }, undefined).isLow, false);
});

test('recommendation review mirrors the backend decision without recomputing it', () => {
  const route = { rankingReason: 'Not recommended: data confidence is 16%, below the 35% threshold.' };
  const insufficient = { recommendationStatus: 'insufficient_data', recommendedRouteIndex: null, recommendationMessage: 'msg' };
  assert.deepEqual(getRecommendationReview(route, 0, insufficient), {
    status: 'not_recommended', headline: 'Not recommended', note: null, reason: route.rankingReason,
  });
  const recommended = { recommendationStatus: 'recommended', recommendedRouteIndex: 1, recommendationMessage: 'ok' };
  assert.equal(getRecommendationReview(route, 1, recommended).status, 'recommended');
  assert.equal(getRecommendationReview(route, 0, recommended).status, 'alternative');
  assert.equal(getRecommendationReview(route, 0, recommended).note, null);
  assert.equal(getRecommendationReview(route, 0, undefined).status, 'alternative');
});
