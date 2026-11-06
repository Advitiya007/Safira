const CACHE_TTL_MS = 20 * 60 * 1000;
const MAX_NEWS_ITEMS = 6;
const POSITIVE_TERMS = /\b(award|awarded|celebrat(?:e|es|ed|ing)|empower(?:s|ed|ing)?|expand(?:s|ed|ing)?|fund(?:s|ed|ing)?|improv(?:e|es|ed|ing)|inaugurat(?:e|es|ed|ing)|initiative|launch(?:es|ed|ing)?|open(?:s|ed|ing)?|recognition|resource(?:s)?|support(?:s|ed|ing)?|train(?:s|ed|ing)?|win(?:s|ning)?|women-led|women's health)\b/i;
const NEGATIVE_TERMS = /\b(abduct(?:ed|ion)?|abuse|assault|attack(?:ed)?|crime|death|dead|harass(?:ment|ed)?|injur(?:y|ed)|kidnap(?:ped|ping)?|kill(?:ed|ing)?|murder|rape|robbery|scam|threat|unsafe|victim|violence|warning|warns|crash|disaster)\b/i;
const GOOGLE_NEWS_RSS_URL = 'https://news.google.com/rss/search?q=India+women+(initiative+OR+launched+OR+award+OR+empowerment+OR+support+OR+training)&hl=en-IN&gl=IN&ceid=IN:en';

let cachedResult = null;
let cacheExpiresAt = 0;

const decodeCodePoint = (value, radix = 10) => {
    const codePoint = Number.parseInt(value, radix);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : '';
};

const decodeXml = (value = '') => value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => decodeCodePoint(code))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => decodeCodePoint(code, 16))
    .replace(/\s+/g, ' ')
    .trim();

const readTag = (xml, tag) => {
    const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? decodeXml(match[1]) : '';
};

export const isPositiveNewsItem = (item) => (
    POSITIVE_TERMS.test(`${item.title} ${item.description}`) &&
    !NEGATIVE_TERMS.test(`${item.title} ${item.description}`)
);

export const parsePositiveNewsFeed = (xml, fetchedAt = new Date(), fallbackSource = 'Google News') => {
    const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
        .map(([, itemXml]) => {
            const title = readTag(itemXml, 'title');
            const description = readTag(itemXml, 'description');
            const link = readTag(itemXml, 'link');
            const publishedAtValue = readTag(itemXml, 'pubDate');
            const publishedAt = publishedAtValue ? new Date(publishedAtValue) : null;
            return {
                title,
                description: description.slice(0, 360),
                url: link,
                source: readTag(itemXml, 'source') || fallbackSource,
                publishedAt: publishedAt && Number.isFinite(publishedAt.getTime())
                    ? publishedAt.toISOString()
                    : null,
            };
        })
        .filter((item) => item.title && item.url && isPositiveNewsItem(item))
        .slice(0, MAX_NEWS_ITEMS);
    return { items, fetchedAt: fetchedAt.toISOString() };
};

export const getPositiveCurrentAffairs = async ({
    fetchImpl = fetch,
    feedUrl = process.env.POSITIVE_NEWS_RSS_URL || GOOGLE_NEWS_RSS_URL,
    now = Date.now(),
    forceRefresh = false,
} = {}) => {
    if (!forceRefresh && cachedResult && cacheExpiresAt > now) return cachedResult;

    const feedHostname = new URL(feedUrl).hostname;
    let response;
    try {
        response = await fetchImpl(feedUrl, {
            headers: { accept: 'application/rss+xml, application/xml, text/xml' },
            signal: AbortSignal.timeout(8000),
        });
    } catch (error) {
        throw Object.assign(new Error(`Positive news feed request failed: ${error.message}`), {
            statusCode: 502,
        });
    }
    if (!response.ok) {
        throw Object.assign(new Error(`Positive news feed request failed (HTTP ${response.status})`), {
            statusCode: 502,
        });
    }

    const result = parsePositiveNewsFeed(
        await response.text(),
        new Date(now),
        feedHostname === 'news.google.com' ? 'Google News' : feedHostname,
    );
    cachedResult = {
        ...result,
        sourceName: feedHostname === 'news.google.com'
            ? 'Google News RSS · India'
            : feedHostname,
        sourceUrl: feedUrl,
    };
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedResult;
};

export const clearPositiveNewsCache = () => {
    cachedResult = null;
    cacheExpiresAt = 0;
};
