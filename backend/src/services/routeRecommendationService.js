import { MINIMUM_RECOMMENDATION_CONFIDENCE } from '../config/safeRouteConfig.js';

const scoreRoutes = (routes) => routes
    .map((route, index) => ({ index, score: route.score, confidence: route.confidence, duration: route.durationSeconds }))
    .filter((route) => Number.isFinite(route.score) && Number.isFinite(route.confidence))
    .sort((first, second) => (
        second.score - first.score ||
        second.confidence - first.confidence ||
        first.duration - second.duration
    ));

const getStrongestIndicatorDifference = (first, second, firstIndex, secondIndex) => {
    const labels = {
        nightActivity: 'night-time activity',
        lighting: 'lighting',
        roadAccessibility: 'road accessibility',
        cctv: 'mapped CCTV',
        emergencyAccess: 'emergency proximity',
        publicTransport: 'public transport proximity',
        isolation: 'mapped activity gaps',
    };
    const differences = Object.entries(first.indicators || {})
        .flatMap(([key, indicator]) => {
            const firstScore = indicator?.score;
            const secondScore = second.indicators?.[key]?.score;
            return Number.isFinite(firstScore) && Number.isFinite(secondScore)
                ? [{ key, difference: firstScore - secondScore }]
                : [];
        })
        .filter(({ difference }) => difference !== 0)
        .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
    const strongest = differences[0];
    if (!strongest) return 'No individual mapped indicator differs between the compared routes.';
    const direction = strongest.difference > 0 ? 'higher' : 'lower';
    return `${labels[strongest.key] || strongest.key} is ${direction} on Route ${firstIndex + 1} (${Math.abs(strongest.difference)} points).`;
};

export const recommendRoute = (
    routes,
    minimumConfidence = MINIMUM_RECOMMENDATION_CONFIDENCE,
) => {
    const ranked = scoreRoutes(routes);
    const eligible = ranked.filter((route) => route.confidence >= minimumConfidence);
    if (!eligible.length) {
        return {
            recommendedRouteIndex: null,
            recommendationStatus: 'insufficient_data',
            recommendationMessage: `Insufficient data to confidently recommend a route. No route met the ${minimumConfidence}% minimum data-confidence threshold.`,
            minimumConfidence,
            rankedRouteIndices: ranked.map(({ index }) => index),
            rankingReasons: routes.map((route) => (
                Number.isFinite(route.confidence) && route.confidence < minimumConfidence
                    ? `Not recommended: data confidence is ${route.confidence}%, below the ${minimumConfidence}% threshold.`
                    : 'Not recommended: mapped route indicators are unavailable.'
            )),
        };
    }

    const winner = eligible[0];
    const comparison = eligible[1] || ranked.find(({ index }) => index !== winner.index);
    return {
        recommendedRouteIndex: winner.index,
        recommendationStatus: 'recommended',
        recommendationMessage: `Route ${winner.index + 1} has the highest mapped-indicator score among routes meeting the ${minimumConfidence}% confidence threshold. This is not a safety guarantee.`,
        minimumConfidence,
        rankedRouteIndices: ranked.map(({ index }) => index),
        rankingReasons: routes.map((route, index) => {
            if (index === winner.index) {
                if (!comparison) {
                    return `Recommended as the only route meeting the ${minimumConfidence}% confidence threshold.`;
                }
                if (comparison.confidence < minimumConfidence) {
                    return `Recommended over Route ${comparison.index + 1}: its higher raw score is not eligible because confidence is ${comparison.confidence}%, below the ${minimumConfidence}% threshold; ${getStrongestIndicatorDifference(route, routes[comparison.index], index, comparison.index)}`;
                }
                return `Ranks above Route ${comparison.index + 1} among routes meeting the confidence threshold (${route.score} vs ${routes[comparison.index].score} mapped-indicator score); ${getStrongestIndicatorDifference(route, routes[comparison.index], index, comparison.index)}`;
            }
            if (!Number.isFinite(route.confidence) || route.confidence < minimumConfidence) {
                return `Not eligible for recommendation: data confidence ${route.confidence ?? 0}% is below the ${minimumConfidence}% threshold.`;
            }
            return `Ranks below Route ${winner.index + 1} among routes meeting the confidence threshold (${route.score} vs ${routes[winner.index].score} mapped-indicator score); ${getStrongestIndicatorDifference(route, routes[winner.index], index, winner.index)}`;
        }),
    };
};
