import assert from 'node:assert/strict';
import test from 'node:test';
import { getOpeningStatus } from '../src/services/openingHoursService.js';
import { isPointInsideCity } from '../src/services/geographicDataService.js';
import { segmentRoute } from '../src/services/routeSegmentationService.js';
import { scoreRouteSegments } from '../src/services/routeScoringService.js';

const makeSegment = (index, start, end, estimatedArrival = new Date('2025-01-06T04:30:00.000Z')) => ({
    index,
    start,
    end,
    center: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    distanceMeters: 100,
    startDistanceMeters: index * 100,
    endDistanceMeters: (index + 1) * 100,
    estimatedArrival,
});

test('city boundary checks include edges and exclude points outside the polygon', () => {
    const boundary = {
        type: 'Polygon',
        coordinates: [[
            [77.1, 28.5], [77.3, 28.5], [77.3, 28.7], [77.1, 28.7], [77.1, 28.5],
        ]],
    };

    assert.equal(isPointInsideCity(28.6, 77.2, boundary), true);
    assert.equal(isPointInsideCity(28.5, 77.2, boundary), true);
    assert.equal(isPointInsideCity(28.8, 77.2, boundary), false);
});

test('segments route geometry and estimates arrival by traveled distance', () => {
    const segments = segmentRoute(
        [[28.6, 77.2], [28.602, 77.2]],
        600,
        new Date('2025-01-06T00:00:00.000Z'),
        150,
    );

    assert.equal(segments.length, 2);
    assert.ok(segments[0].estimatedArrival < segments[1].estimatedArrival);
    assert.ok(Math.abs(segments.reduce((sum, segment) => sum + segment.distanceMeters, 0) - 222.4) < 2);
});

test('opening hours are evaluated at the city-local arrival time', () => {
    assert.equal(
        getOpeningStatus('Mo-Su 09:00-17:00', new Date('2025-01-06T04:30:00.000Z')).status,
        'open',
    );
    assert.equal(
        getOpeningStatus('Mo-Su 09:00-17:00', new Date('2025-01-06T13:30:00.000Z')).status,
        'closed',
    );
    assert.equal(getOpeningStatus(undefined, new Date()).status, 'unknown');
    assert.equal(getOpeningStatus('not valid hours', new Date()).status, 'unknown');
});

test('night activity score reflects whether mapped establishments are open at arrival', () => {
    const segment = makeSegment(0, [28.6, 77.2], [28.6009, 77.2]);
    const features = [{
        osmType: 'node',
        osmId: 'restaurant',
        geometry: { type: 'Point', coordinates: [77.2, 28.6005] },
        tags: { amenity: 'restaurant', opening_hours: 'Mo-Su 09:00-17:00' },
    }];
    const options = {
        mode: 'walking',
        timezone: 'Asia/Kolkata',
        searchRadiusMeters: 125,
        osmDataTimestamp: null,
    };
    const daytime = scoreRouteSegments(
        [{ ...segment, estimatedArrival: new Date('2025-01-06T04:30:00.000Z') }],
        features,
        options,
    );
    const lateNight = scoreRouteSegments(
        [{ ...segment, estimatedArrival: new Date('2025-01-06T13:30:00.000Z') }],
        features,
        options,
    );

    assert.equal(daytime.segments[0].indicators.nightActivity, 50);
    assert.equal(lateNight.segments[0].indicators.nightActivity, 0);
    assert.ok(daytime.score > lateNight.score);
});

test('scoring detects mapped road lines crossing a route and reports confidence separately', () => {
    const segments = [makeSegment(0, [28.6, 77.2], [28.6009, 77.2])];
    const features = [
        {
            osmType: 'way',
            osmId: 'road-crossing',
            geometry: {
                type: 'LineString',
                coordinates: [[77.1995, 28.6005], [77.2005, 28.6005]],
            },
            tags: { highway: 'residential', lit: 'yes' },
        },
        {
            osmType: 'node',
            osmId: 'open-pharmacy',
            geometry: { type: 'Point', coordinates: [77.2, 28.6005] },
            tags: { amenity: 'pharmacy', opening_hours: '24/7' },
        },
    ];

    const result = scoreRouteSegments(segments, features, {
        mode: 'walking',
        timezone: 'Asia/Kolkata',
        searchRadiusMeters: 125,
        osmDataTimestamp: new Date('2025-01-05T00:00:00.000Z'),
        now: new Date('2025-01-06T00:00:00.000Z'),
    });

    assert.ok(Number.isFinite(result.score));
    assert.ok(result.confidence > 0);
    assert.equal(result.segments[0].indicators.roadAccessibility, 85);
    assert.equal(result.segments[0].indicators.lighting, 100);
    assert.equal(result.facilities[0].type, 'Pharmacy');
});

test('a capped spatial feature query lowers confidence and is disclosed', () => {
    const segment = makeSegment(0, [28.6, 77.2], [28.6009, 77.2]);
    const features = [{
        osmType: 'way',
        osmId: 'road',
        geometry: { type: 'LineString', coordinates: [[77.1995, 28.6005], [77.2005, 28.6005]] },
        tags: { highway: 'residential', lit: 'yes' },
    }];
    const options = { mode: 'walking', timezone: 'Asia/Kolkata', searchRadiusMeters: 125 };
    const complete = scoreRouteSegments([segment], features, options);
    const capped = scoreRouteSegments([segment], features, { ...options, featureQueryTruncated: true });

    assert.ok(capped.confidence < complete.confidence);
    assert.ok(capped.explanations.some((explanation) => explanation.includes('reached its result limit')));
});

test('unknown opening hours remain unknown and empty activity data does not invent an isolation score', () => {
    const result = scoreRouteSegments(
        [makeSegment(0, [28.6, 77.2], [28.6009, 77.2])],
        [{
            osmType: 'node',
            osmId: 'shop-unknown-hours',
            geometry: { type: 'Point', coordinates: [77.2, 28.6005] },
            tags: { shop: 'convenience' },
        }],
        {
            mode: 'driving',
            timezone: 'Asia/Kolkata',
            searchRadiusMeters: 200,
            osmDataTimestamp: null,
        },
    );

    assert.equal(result.segments[0].indicators.nightActivity, null);
    assert.equal(result.segments[0].evidence.unknownHoursCount, 1);
    assert.equal(result.segments[0].indicators.isolation, 100);
    assert.ok(result.explanations.some((explanation) => explanation.includes('not counted as open or closed')));
});

test('an activity-free stretch is flagged only as an unmapped gap, not as a safety fact', () => {
    const segments = [
        makeSegment(0, [28.6, 77.2], [28.6009, 77.2]),
        makeSegment(1, [28.61, 77.2], [28.6109, 77.2]),
    ];
    const features = [{
        osmType: 'node',
        osmId: 'shop',
        geometry: { type: 'Point', coordinates: [77.2, 28.6005] },
        tags: { amenity: 'cafe', opening_hours: 'Mo-Su 09:00-22:00' },
    }];

    const result = scoreRouteSegments(segments, features, {
        mode: 'walking',
        timezone: 'Asia/Kolkata',
        searchRadiusMeters: 125,
        osmDataTimestamp: null,
    });

    assert.equal(result.segments[1].indicators.isolation, 0);
    assert.ok(result.explanations.some((explanation) => explanation.includes('without a mapped establishment nearby')));
    assert.ok(result.confidence < 100);
});

test('missing city OSM features leave route score unavailable and confidence at zero', () => {
    const result = scoreRouteSegments(
        [makeSegment(0, [28.6, 77.2], [28.6009, 77.2])],
        [],
        { mode: 'driving', timezone: 'Asia/Kolkata', searchRadiusMeters: 200 },
    );

    assert.equal(result.score, null);
    assert.equal(result.confidence, 0);
    assert.ok(result.explanations.some((explanation) => explanation.includes('unavailable')));
});
