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

// ---- "Mapped help nearby" strip (display only; never feeds score, confidence or ranking) ----
// Each route segment carries counts of mapped police / hospital+clinic / pharmacy records within
// the emergency search radius (1 km, straight-line). Zero means "none MAPPED", not "none exist".

const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

export const getFacilityStrip = (route) => {
  const segments = Array.isArray(route?.segments) ? route.segments : [];
  const cells = segments.map((segment) => {
    const evidence = segment?.evidence || {};
    const police = count(evidence.policeCount);
    const hospital = count(evidence.hospitalCount);
    const pharmacy = count(evidence.pharmacyCount);
    return { police, hospital, pharmacy, total: police + hospital + pharmacy, open24x7: count(evidence.open24x7Count) };
  });

  const facilities = Array.isArray(route?.facilities) ? route.facilities : [];
  const byType = (type) => facilities.filter((facility) => facility.type === type).length;
  const knows24x7 = facilities.some((facility) => typeof facility.open24x7 === 'boolean');
  const emergency = facilities.filter((facility) => ['Police', 'Hospital', 'Clinic', 'Pharmacy'].includes(facility.type));

  return {
    cells,
    maxCell: cells.reduce((max, cell) => Math.max(max, cell.total), 0),
    segmentsWithHelp: cells.filter((cell) => cell.total > 0).length,
    totals: {
      police: byType('Police'),
      hospital: byType('Hospital') + byType('Clinic'),
      pharmacy: byType('Pharmacy'),
      // null = this analysis predates the flag, so the 24/7 count is unknown (not zero)
      open24x7: knows24x7 ? emergency.filter((facility) => facility.open24x7 === true).length : null,
    },
  };
};

// One scale for every route so the colours are comparable between cards.
export const getSharedStripMax = (routes) => (
  Math.max(1, ...(routes || []).map((route) => getFacilityStrip(route).maxCell))
);

// 0 = none mapped; 1..4 = quartile of the shared maximum.
export const getStripLevel = (total, sharedMax) => {
  if (!total) return 0;
  return Math.min(4, Math.max(1, Math.ceil((total / Math.max(1, sharedMax)) * 4)));
};
