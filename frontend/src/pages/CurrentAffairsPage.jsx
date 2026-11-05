import { useEffect, useState } from 'react';
import { Clock, ExternalLink, Loader2, Newspaper, RefreshCw, Share2, TrendingUp } from 'lucide-react';
import { dashboardAPI } from '../utils/api';

const formatDate = (dateString) => {
    const date = new Date(dateString);
    return Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
        : null;
};

export default function CurrentAffairsPage() {
    const [feed, setFeed] = useState(null);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        dashboardAPI.getPositiveCurrentAffairs(controller.signal, retry > 0)
            .then((response) => {
                if (controller.signal.aborted) return;
                if (!response?.success || !Array.isArray(response.data?.items)) {
                    throw new Error('Current affairs feed returned an invalid response');
                }
                setFeed(response.data);
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                setFeed(null);
                setError('Current affairs are temporarily unavailable. Please try again later.');
            });

        return () => controller.abort();
    }, [retry]);

    const handleShare = async (item) => {
        try {
            if (navigator.share) {
                await navigator.share({ title: item.title, url: item.url });
            } else {
                await navigator.clipboard.writeText(item.url);
            }
        } catch (shareError) {
            if (shareError.name !== 'AbortError') {
                console.error('Unable to share current-affairs story:', shareError);
            }
        }
    };

    const handleRetry = () => {
        setFeed(null);
        setError('');
        setRetry((attempt) => attempt + 1);
    };

    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
            <header className="mb-6 rounded-3xl bg-gradient-to-br from-[#2D1B2E] to-[#8B4A6A] p-5 text-white sm:mb-8 sm:p-8">
                <div className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-pink-100">
                    <TrendingUp className="h-4 w-4" />
                    Current affairs
                </div>
                <h1 className="font-serif text-3xl font-bold leading-tight sm:text-4xl">Hopeful news and initiatives</h1>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base">
                    A keyword-screened feed of stories related to India, women, and community initiatives.
                </p>
            </header>

            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <Newspaper className="h-5 w-5 text-[#8B4A6A]" />
                    <h2 className="font-serif text-xl font-bold text-[#2D1B2E]">Latest stories</h2>
                </div>
                {feed?.fetchedAt && (
                    <p className="text-xs text-[#6B5B6B]">
                        Updated {formatDate(feed.fetchedAt) || 'recently'} · {feed.sourceName}
                    </p>
                )}
            </div>

            {error ? (
                <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                    <p>{error}</p>
                    <button
                        type="button"
                        onClick={handleRetry}
                        className="mt-3 inline-flex items-center gap-2 font-bold underline underline-offset-2"
                    >
                        <RefreshCw className="h-4 w-4" /> Try again
                    </button>
                </div>
            ) : feed === null ? (
                <div className="flex min-h-48 items-center justify-center gap-3 rounded-2xl bg-white p-6 text-sm text-[#6B5B6B] shadow-sm">
                    <Loader2 className="h-5 w-5 animate-spin text-[#8B4A6A]" />
                    Loading stories…
                </div>
            ) : feed.items.length === 0 ? (
                <div className="rounded-2xl bg-white p-6 text-sm text-[#6B5B6B] shadow-sm">
                    No stories currently match the positive-content filter. Please check again later.
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {feed.items.map((item) => (
                        <article key={item.url} className="flex min-w-0 flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
                            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6B5B6B]">
                                <span className="rounded-full bg-emerald-50 px-3 py-1 font-bold text-emerald-800">Positive story</span>
                                {item.publishedAt && (
                                    <span className="inline-flex items-center gap-1">
                                        <Clock className="h-3.5 w-3.5" /> {formatDate(item.publishedAt)}
                                    </span>
                                )}
                            </div>
                            <h3 className="font-serif text-xl font-bold leading-snug text-[#2D1B2E]">
                                <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-[#8B4A6A]">
                                    {item.title}
                                </a>
                            </h3>
                            {item.description && (
                                <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-[#6B5B6B]">{item.description}</p>
                            )}
                            <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                                <span className="truncate text-xs font-semibold text-gray-500">{item.source}</span>
                                <div className="flex shrink-0 items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => handleShare(item)}
                                        aria-label={`Share ${item.title}`}
                                        className="rounded-lg p-2 text-[#6B5B6B] hover:bg-gray-50 hover:text-[#8B4A6A]"
                                    >
                                        <Share2 className="h-4 w-4" />
                                    </button>
                                    <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-bold text-[#8B4A6A]">
                                        Read source <ExternalLink className="h-4 w-4" />
                                    </a>
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            )}

            <p className="mt-6 text-xs leading-relaxed text-gray-500">
                Source: {feed?.sourceName || 'external RSS feed'}. Stories are selected by keyword screening and are not independently verified, official safety alerts, or a guarantee of safety.
            </p>
        </div>
    );
}
