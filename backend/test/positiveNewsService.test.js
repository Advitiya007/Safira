import test from 'node:test';
import assert from 'node:assert/strict';
import {
    clearPositiveNewsCache,
    getPositiveCurrentAffairs,
    parsePositiveNewsFeed,
} from '../src/services/positiveNewsService.js';

const makeFeed = (items) => `<rss><channel>${items.map((item) => `
    <item>
      <title><![CDATA[${item.title}]]></title>
      <description>${item.description}</description>
      <link>${item.url}</link>
      <source>${item.source || 'Example Publisher'}</source>
      <pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate>
    </item>`).join('')}</channel></rss>`;

test('positive current-affairs parser includes positive stories and filters negative headlines', () => {
    const feed = makeFeed([
        {
            title: 'Women-led group wins a national award',
            description: 'The group was recognized for its community support.',
            url: 'https://example.test/award',
        },
        {
            title: 'New safety program announced after an assault',
            description: 'Officials announced a new initiative.',
            url: 'https://example.test/assault',
        },
        {
            title: 'New training initiative supports girls',
            description: 'A new community program opens this month.',
            url: 'https://example.test/training',
        },
    ]);

    const result = parsePositiveNewsFeed(feed, new Date('2026-06-02T00:00:00.000Z'));
    assert.deepEqual(result.items.map((item) => item.url), [
        'https://example.test/award',
        'https://example.test/training',
    ]);
    assert.equal(result.items[0].source, 'Example Publisher');
    assert.equal(result.items[0].publishedAt, '2026-06-01T10:00:00.000Z');
    assert.equal(result.fetchedAt, '2026-06-02T00:00:00.000Z');
});

test('positive current-affairs parser attributes items to a configured feed when source tags are absent', () => {
    const feed = makeFeed([{
        title: 'Women win community award',
        description: 'The program earned recognition.',
        url: 'https://example.test/award',
    }]).replace('<source>Example Publisher</source>', '');
    const result = parsePositiveNewsFeed(feed, new Date('2026-06-02T00:00:00.000Z'), 'news.example.test');

    assert.equal(result.items[0].source, 'news.example.test');
});

test('current-affairs feed caches successful results and supports explicit refresh', async () => {
    clearPositiveNewsCache();
    let requestCount = 0;
    const fetchImpl = async () => {
        requestCount += 1;
        return {
            ok: true,
            text: async () => makeFeed([{
                title: `Women win community award ${requestCount}`,
                description: 'The program earned recognition.',
                url: `https://example.test/${requestCount}`,
            }]),
        };
    };
    const options = { fetchImpl, feedUrl: 'https://example.test/feed', now: 1_000 };

    const first = await getPositiveCurrentAffairs(options);
    const cached = await getPositiveCurrentAffairs(options);
    const refreshed = await getPositiveCurrentAffairs({ ...options, forceRefresh: true });

    assert.equal(requestCount, 2);
    assert.equal(cached.items[0].url, first.items[0].url);
    assert.notEqual(refreshed.items[0].url, first.items[0].url);
    clearPositiveNewsCache();
});

test('current-affairs feed reports upstream HTTP failures', async () => {
    clearPositiveNewsCache();
    await assert.rejects(
        getPositiveCurrentAffairs({
            fetchImpl: async () => ({ ok: false, status: 503 }),
            feedUrl: 'https://example.test/feed',
            now: 2_000,
        }),
        (error) => error.statusCode === 502 && /HTTP 503/.test(error.message),
    );
    clearPositiveNewsCache();
});
