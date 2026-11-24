// Pure helpers that decide what a Safe Route card shows. Kept free of React so they can be
// unit-tested with `node --test` and so the card and its details panel stay consistent.
//
// Rule: an indicator with no mapped data is "unknown". Unknowns are NOT shown on the card
// (they are listed once, in the details panel, because they are the reason confidence is low).
// Nothing here changes any score, confidence value or ranking.

export const SCORE_LABELS = {
  nightActivity: 'night-time activity',
  lighting: 'lighting',
  roadAccessibility: 'road access',
  cctv: 'mapped CCTV',
  emergencyAccess: 'emergency proximity',
  publicTransport: 'public transport',
  isolation: 'mapped activity proximity',
};

const hasScore = (value) => Number.isFinite(value?.score);

export const splitIndicators = (indicators) => {
  const known = [];
  const unknown = [];
  Object.entries(indicators || {}).forEach(([key, value]) => {
    const label = SCORE_LABELS[key] || key;
    if (hasScore(value)) {
      known.push({ key, label, score: value.score, coveragePercent: value.coveragePercent });
    } else {
      unknown.push({ key, label });
    }
  });
  return { known, unknown };
};

export const getConfidenceSummary = (route, minimumConfidence) => {
  const { known, unknown } = splitIndicators(route?.indicators);
  const percent = Number.isFinite(route?.confidence) ? route.confidence : null;
  const threshold = Number.isFinite(minimumConfidence) ? minimumConfidence : null;
  return {
    percent,
    threshold,
    isLow: percent !== null && threshold !== null && percent < threshold,
    knownCount: known.length,
    totalCount: known.length + unknown.length,
    missingLabels: unknown.map(({ label }) => label),
    coveredDistancePercent: Number.isFinite(route?.scoredSegmentCoveragePercent)
      ? route.scoredSegmentCoveragePercent
      : null,
  };
};

export const getRecommendationReview = (route, index, routeMetadata) => {
  const recommendedIndex = routeMetadata?.recommendedRouteIndex;
  if (Number.isInteger(recommendedIndex) && recommendedIndex === index) {
    return {
      status: 'recommended',
      headline: 'Recommended',
      note: routeMetadata?.recommendationMessage || null,
      reason: route?.rankingReason || null,
    };
  }
  if (routeMetadata?.recommendationStatus === 'insufficient_data') {
    return {
      status: 'not_recommended',
      headline: 'Not recommended',
      // The reason and the confidence section already state the threshold; do not repeat it a third time.
      note: null,
      reason: route?.rankingReason || null,
    };
  }
  return {
    status: 'alternative',
    headline: 'Not the top-ranked route',
    note: null,
    reason: route?.rankingReason || null,
  };
};
