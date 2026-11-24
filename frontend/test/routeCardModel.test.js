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

import { getFacilityStrip, getSharedStripMax, getStripLevel } from '../src/utils/routeCardModel.js';

const seg = (police, hospital, pharmacy, open24x7 = 0) => ({ evidence: { policeCount: police, hospitalCount: hospital, pharmacyCount: pharmacy, open24x7Count: open24x7 } });

test('facility strip sums police/hospital/pharmacy per segment and counts unique places per route', () => {
  const route = {
    segments: [seg(1, 0, 2), seg(0, 0, 0), seg(0, 1, 0)],
    facilities: [
      { type: 'Police', open24x7: false }, { type: 'Pharmacy', open24x7: true },
      { type: 'Clinic', open24x7: false }, { type: 'Mapped establishment', open24x7: true },
    ],
  };
  const strip = getFacilityStrip(route);
  assert.deepEqual(strip.cells.map((cell) => cell.total), [3, 0, 1]);
  assert.equal(strip.maxCell, 3);
  assert.equal(strip.segmentsWithHelp, 2);
  assert.deepEqual(strip.totals, { police: 1, hospital: 1, pharmacy: 1, open24x7: 1 });
});

test('24/7 total is unknown (null), not zero, when the analysis predates the flag; missing data is safe', () => {
  const strip = getFacilityStrip({ segments: [seg(1, 0, 0)], facilities: [{ type: 'Police' }] });
  assert.equal(strip.totals.open24x7, null);
  assert.deepEqual(getFacilityStrip({}).cells, []);
  assert.deepEqual(getFacilityStrip(null).totals.police, 0);
});

test('strip levels use one shared scale across routes; zero is its own level', () => {
  const routes = [{ segments: [seg(4, 0, 0)] }, { segments: [seg(1, 0, 0)] }];
  const max = getSharedStripMax(routes);
  assert.equal(max, 4);
  assert.equal(getStripLevel(0, max), 0);
  assert.equal(getStripLevel(1, max), 1);
  assert.equal(getStripLevel(4, max), 4);
  assert.equal(getSharedStripMax([]), 1);
});
