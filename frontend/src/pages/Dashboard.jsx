import { createElement, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Bell,
  CheckCircle2,
  Clock,
  Heart,
  Loader2,
  MapPin,
  Newspaper,
  Shield,
  Users,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import useLocation from '../hooks/useLocation';
import { useSafetyTracking } from '../hooks/useSafetyTracking';
import CustomMapContainer from '../components/Map/MapContainer';
import { activityAPI, dashboardAPI, guardianAPI, sosAPI } from '../utils/api';
import { WELLNESS_GUIDES } from '../data/wellnessGuides';

const StatCard = ({ icon, label, value, detail, color }) => (
  <div className="card-premium flex min-w-0 items-center gap-4 p-5 sm:p-6">
    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${color}`}>
      {createElement(icon, { className: 'h-6 w-6' })}
    </div>
    <div className="min-w-0">
      <p className="text-xs font-bold uppercase tracking-wider text-[#6B5B6B]">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums text-[#2D1B2E]">{value}</p>
      <p className="truncate text-xs text-[#6B5B6B]">{detail}</p>
    </div>
  </div>
);

const SetupCheck = ({ complete, title, detail }) => {
  const icon = complete ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-start gap-3">
      {createElement(icon, { className: `mt-0.5 h-5 w-5 shrink-0 ${complete ? 'text-emerald-600' : 'text-gray-400'}` })}
      <div>
        <p className="text-sm font-bold text-[#2D1B2E]">{title}</p>
        <p className="text-xs text-[#6B5B6B]">{detail}</p>
      </div>
    </div>
  );
};

const formatRelativeTime = (dateString) => {
  const timestamp = new Date(dateString).getTime();
  if (!Number.isFinite(timestamp)) return 'Time unavailable';
  const hoursAgo = Math.max(0, Math.floor((Date.now() - timestamp) / (1000 * 60 * 60)));
  if (hoursAgo === 0) return 'Just now';
  if (hoursAgo < 24) return `${hoursAgo} hour${hoursAgo === 1 ? '' : 's'} ago`;
  if (hoursAgo < 48) return 'Yesterday';
  const daysAgo = Math.floor(hoursAgo / 24);
  return `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`;
};

const formatDate = (dateString) => {
  const date = new Date(dateString);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
    : null;
};

export default function Dashboard() {
  const { user } = useAuth();
  const { location, pois, isLoading: isMapLoading, error: locationError } = useLocation({
    radius: 5000,
    maxEach: 4,
  });
  const { trackingActive } = useSafetyTracking();
  const [activities, setActivities] = useState(null);
  const [verifiedGuardians, setVerifiedGuardians] = useState(null);
  const [sosHistory, setSosHistory] = useState(null);
  const [news, setNews] = useState(null);
  const [newsError, setNewsError] = useState('');
  const [dashboardError, setDashboardError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [newsRetry, setNewsRetry] = useState(0);
  const wellnessGuide = WELLNESS_GUIDES[new Date().getDate() % WELLNESS_GUIDES.length];
  const activeSosCount = (sosHistory || []).filter((item) => item.status === 'triggered').length;
  const setupReady = trackingActive && verifiedGuardians > 0;
  const setupStatusAvailable = verifiedGuardians !== null;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    Promise.allSettled([
      activityAPI.getActivities(signal),
      guardianAPI.getGuardians(signal),
      sosAPI.getHistory(signal),
    ]).then(([activityResult, guardianResult, sosResult]) => {
      if (signal.aborted) return;

      const failures = [];
      if (activityResult.status === 'fulfilled' && activityResult.value?.success) {
        setActivities(activityResult.value.data || []);
      } else {
        setActivities(null);
        failures.push('Recent activity');
      }

      if (guardianResult.status === 'fulfilled' && guardianResult.value?.success) {
        const activeVerified = (guardianResult.value.data || []).filter(
          (guardian) => guardian.isVerified && guardian.status === 'active',
        );
        setVerifiedGuardians(activeVerified.length);
      } else {
        setVerifiedGuardians(null);
        failures.push('Trusted contacts');
      }

      if (sosResult.status === 'fulfilled' && sosResult.value?.success) {
        setSosHistory(sosResult.value.data || []);
      } else {
        setSosHistory(null);
        failures.push('SOS records');
      }

      if (failures.length) {
        setDashboardError(`Could not load ${failures.join(', ').toLowerCase()}.`);
      }
      setIsLoading(false);
    });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    dashboardAPI.getPositiveCurrentAffairs(controller.signal, newsRetry > 0)
      .then((response) => {
        if (controller.signal.aborted) return;
        if (!response?.success) throw new Error('Current affairs feed returned an unsuccessful response');
        setNews(response.data);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setNews(null);
        setNewsError('Positive current-affairs feed is temporarily unavailable.');
      });

    return () => controller.abort();
  }, [newsRetry]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#8B4A6A]">
            Safira dashboard
          </p>
          <h1 className="break-words font-serif text-3xl font-bold tracking-tight text-[#2D1B2E] sm:text-4xl">
            Welcome back, <span className="text-[#8B4A6A]">{user?.fullName || 'there'}</span>
          </h1>
          <p className="mt-2 text-sm text-[#6B5B6B] sm:text-base">
            A snapshot of your safety tools, trusted contacts and local information.
          </p>
        </div>
        <div className={`w-fit rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide ${setupReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
          Level 1 · {!setupStatusAvailable ? 'Status unavailable' : setupReady ? 'Setup ready' : 'Setup incomplete'}
        </div>
      </header>

      {dashboardError && (
        <p role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {dashboardError} Some dashboard indicators may be incomplete.
        </p>
      )}

      {activeSosCount > 0 && (
        <section role="alert" className="mb-6 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-bold text-red-900">
              {activeSosCount} active SOS record{activeSosCount === 1 ? '' : 's'}
            </p>
            <p className="text-sm text-red-800">Review your SOS status and resolve it when appropriate.</p>
          </div>
          <Link to="/sos" className="inline-flex items-center gap-2 self-start rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 sm:self-auto">
            Open SOS <ArrowUpRight className="h-4 w-4" />
          </Link>
        </section>
      )}

      <section aria-label="Level 1 safety setup" className="card-premium mb-6 grid gap-6 p-5 sm:mb-8 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)] sm:p-6">
        <div>
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#8B4A6A]/10 text-[#8B4A6A]">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-serif text-xl font-bold text-[#2D1B2E]">Level 1 safety setup</h2>
              <p className="text-xs text-[#6B5B6B]">Account setup indicators, not a safety guarantee.</p>
            </div>
          </div>
          <p className="max-w-2xl text-sm leading-relaxed text-[#6B5B6B]">
            {setupReady
              ? 'Live tracking is on and you have at least one verified active trusted contact.'
              : 'Turn on live tracking and add a verified trusted contact to complete these setup indicators.'}
          </p>
        </div>
        <div className="space-y-4 rounded-xl bg-gray-50 p-4">
          <SetupCheck
            complete={trackingActive}
            title={trackingActive ? 'Live tracking is active' : 'Live tracking is off'}
            detail={trackingActive ? 'Location updates are being shared for this session.' : 'Enable it from the map or tracking controls when needed.'}
          />
          <SetupCheck
            complete={verifiedGuardians > 0}
            title={verifiedGuardians === null
              ? 'Trusted contact status unavailable'
              : `${verifiedGuardians} verified trusted contact${verifiedGuardians === 1 ? '' : 's'}`}
            detail={verifiedGuardians === null
              ? 'Contact status is unavailable right now.'
              : 'Only active contacts with verified status are counted.'}
          />
        </div>
      </section>

      <section aria-label="Dashboard summary" className="mb-6 grid grid-cols-1 gap-3 sm:mb-8 sm:grid-cols-3 sm:gap-4">
        <StatCard
          icon={Users}
          label="Verified contacts"
          value={isLoading || verifiedGuardians === null ? '—' : verifiedGuardians}
          detail={verifiedGuardians === null ? 'Status unavailable' : 'Active trusted contacts'}
          color="bg-blue-50 text-blue-700"
        />
        <StatCard
          icon={Bell}
          label="SOS records"
          value={isLoading || sosHistory === null ? '—' : sosHistory.length}
          detail={sosHistory === null
            ? 'Status unavailable'
            : activeSosCount ? `${activeSosCount} currently active` : 'No active SOS records'}
          color="bg-rose-50 text-rose-700"
        />
        <StatCard
          icon={MapPin}
          label="Mapped locations"
          value={isMapLoading ? '—' : pois.length}
          detail="Nearby support places shown"
          color="bg-emerald-50 text-emerald-700"
        />
      </section>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3 lg:gap-6">
        <div className="min-w-0 space-y-5 lg:col-span-2 lg:space-y-6">
          <section className="card-premium overflow-hidden !p-0">
            <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="flex items-center gap-3">
                <MapPin className="h-5 w-5 text-[#8B4A6A]" />
                <div>
                  <h2 className="font-serif text-lg font-bold text-[#2D1B2E]">Nearby map</h2>
                  <p className="text-xs text-[#6B5B6B]">Your location and mapped support places</p>
                </div>
              </div>
              <Link to="/map" className="inline-flex items-center gap-1 self-start text-sm font-bold text-[#8B4A6A] hover:text-[#C94A7D] sm:self-auto">
                Open full map <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="relative h-[18rem] bg-gray-50 sm:h-[22rem]">
              {isMapLoading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-[#8B4A6A]" />
                  <p className="text-sm font-medium text-[#6B5B6B]">Loading map data…</p>
                </div>
              ) : (
                <CustomMapContainer location={location} pois={pois} />
              )}
            </div>
            {locationError && (
              <p className="border-t border-gray-100 px-4 py-3 text-xs text-amber-800 sm:px-5">
                {locationError}
              </p>
            )}
          </section>

          <section className="card-premium p-5 sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Newspaper className="h-5 w-5 shrink-0 text-[#8B4A6A]" />
                <div>
                  <h2 className="font-serif text-lg font-bold text-[#2D1B2E]">Positive current affairs</h2>
                  <p className="text-xs text-[#6B5B6B]">Keyword-screened headlines from an external feed</p>
                </div>
              </div>
              <Link to="/current-affairs" aria-label="Open current affairs" className="shrink-0 text-[#8B4A6A]">
                <ArrowUpRight className="h-5 w-5" />
              </Link>
            </div>
            {newsError ? (
              <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                <p>{newsError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setNews(null);
                    setNewsError('');
                    setNewsRetry((attempt) => attempt + 1);
                  }}
                  className="mt-3 font-bold underline underline-offset-2"
                >
                  Try again
                </button>
              </div>
            ) : news === null ? (
              <div className="flex items-center gap-2 py-4 text-sm text-[#6B5B6B]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading headlines…
              </div>
            ) : news.items.length === 0 ? (
              <p className="rounded-xl bg-gray-50 p-4 text-sm text-[#6B5B6B]">
                No headlines matched the positive-content filter. Try again later.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {news.items.slice(0, 3).map((item) => (
                  <li key={item.url} className="py-3 first:pt-1 last:pb-1">
                    <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold leading-snug text-[#2D1B2E] hover:text-[#8B4A6A]">
                      {item.title}
                    </a>
                    <p className="mt-1 text-xs text-[#6B5B6B]">
                      {item.source}{item.publishedAt ? ` · ${formatDate(item.publishedAt)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-500">
              {news?.sourceName || 'External news feed'}
              {news?.fetchedAt ? ` · Updated ${formatDate(news.fetchedAt)}` : ''}
              {' · Headlines are keyword-screened and are not Safira alerts or independently verified.'}
            </p>
          </section>

          <section className="card-premium p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <Heart className="h-5 w-5 text-[#C94A7D]" />
              <div>
                <h2 className="font-serif text-lg font-bold text-[#2D1B2E]">Wellness guide of the day</h2>
                <p className="text-xs text-[#6B5B6B]">A daily selection from the Safira wellness library</p>
              </div>
            </div>
            <div className="rounded-xl bg-[#FFF8F0] p-4 sm:p-5">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#8B4A6A]">{wellnessGuide.category}</p>
              <h3 className="font-serif text-lg font-bold text-[#2D1B2E]">{wellnessGuide.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#6B5B6B]">{wellnessGuide.desc}</p>
              <Link to="/wellness" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#8B4A6A] hover:text-[#C94A7D]">
                Browse wellness guides <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </section>
        </div>

        <aside className="min-w-0">
          <section className="card-premium p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <Clock className="h-5 w-5 text-[#8B4A6A]" />
              <h2 className="font-serif text-lg font-bold text-[#2D1B2E]">Recent activity</h2>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-[#6B5B6B]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
              </div>
            ) : activities === null ? (
              <p className="py-8 text-center text-sm text-amber-800">Activity is temporarily unavailable.</p>
            ) : activities.length === 0 ? (
              <p className="py-8 text-center text-sm text-[#6B5B6B]">No recent activity to show.</p>
            ) : (
              <ul className="space-y-5">
                {activities.slice(0, 5).map((activity, index) => (
                  <li key={activity._id || `${activity.action}-${activity.timestamp}-${index}`} className="flex gap-3">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#8B4A6A] ring-4 ring-[#8B4A6A]/10" />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold capitalize text-[#2D1B2E]">
                        {(activity.action || 'Activity').replaceAll('_', ' ')}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">{formatRelativeTime(activity.timestamp)}</p>
                      <p className="mt-1 text-xs text-[#8B4A6A]">
                        {activity.details?.latitude ? 'Location recorded' : 'System event'}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
