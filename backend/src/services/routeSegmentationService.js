const EARTH_RADIUS_METERS = 6371008.8;

export const distanceMeters = (first, second) => {
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const latitudeDelta = toRadians(second[0] - first[0]);
    const longitudeDelta = toRadians(second[1] - first[1]);
    const latitude1 = toRadians(first[0]);
    const latitude2 = toRadians(second[0]);
    const haversine =
        Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

const interpolate = (first, second, ratio) => [
    first[0] + (second[0] - first[0]) * ratio,
    first[1] + (second[1] - first[1]) * ratio,
];

const locationAtDistance = (coordinates, distances, target) => {
    for (let index = 1; index < distances.length; index += 1) {
        if (distances[index] >= target) {
            const span = distances[index] - distances[index - 1];
            const ratio = span === 0 ? 0 : (target - distances[index - 1]) / span;
            return interpolate(coordinates[index - 1], coordinates[index], ratio);
        }
    }
    return coordinates[coordinates.length - 1];
};

export const segmentRoute = (coordinates, durationSeconds, departureTime, segmentLengthMeters) => {
    if (
        !Array.isArray(coordinates) ||
        coordinates.length < 2 ||
        coordinates.some((point) => (
            !Array.isArray(point) ||
            point.length !== 2 ||
            !Number.isFinite(point[0]) ||
            !Number.isFinite(point[1])
        ))
    ) {
        throw new Error('Route geometry requires at least two valid [latitude, longitude] coordinates');
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0 ||
        !Number.isFinite(segmentLengthMeters) || segmentLengthMeters <= 0) {
        throw new Error('Route duration and segment length must be valid non-negative values');
    }

    const cumulativeDistances = [0];
    for (let index = 1; index < coordinates.length; index += 1) {
        cumulativeDistances.push(
            cumulativeDistances[index - 1] + distanceMeters(coordinates[index - 1], coordinates[index]),
        );
    }
    const totalDistanceMeters = cumulativeDistances[cumulativeDistances.length - 1];
    if (totalDistanceMeters <= 0) throw new Error('Route geometry has no measurable distance');

    const segmentCount = Math.ceil(totalDistanceMeters / segmentLengthMeters);
    return Array.from({ length: segmentCount }, (_, index) => {
        const startDistanceMeters = index * segmentLengthMeters;
        const endDistanceMeters = Math.min((index + 1) * segmentLengthMeters, totalDistanceMeters);
        const midpointDistanceMeters = (startDistanceMeters + endDistanceMeters) / 2;
        const start = locationAtDistance(coordinates, cumulativeDistances, startDistanceMeters);
        const end = locationAtDistance(coordinates, cumulativeDistances, endDistanceMeters);
        const center = locationAtDistance(coordinates, cumulativeDistances, midpointDistanceMeters);
        const estimatedArrival = new Date(
            departureTime.getTime() + durationSeconds * 1000 * (midpointDistanceMeters / totalDistanceMeters),
        );

        return {
            index,
            start,
            end,
            center,
            distanceMeters: endDistanceMeters - startDistanceMeters,
            startDistanceMeters,
            endDistanceMeters,
            estimatedArrival,
        };
    });
};
