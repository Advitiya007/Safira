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
  RefreshCw,
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
      <p className="text-xs font-bold uppercase tracking-wider text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums text-ink">{value}</p>
      <p className="truncate text-xs text-ink-muted">{detail}</p>
    </div>
  </div>
);

const SetupCheck = ({ complete, title, detail }) => {
  const icon = complete ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-start gap-3">
      {createElement(icon, { className: `mt-0.5 h-5 w-5 shrink-0 ${complete ? 'text-success' : 'text-ink-muted'}` })}
      <div>
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="text-xs text-ink-muted">{detail}</p>
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
  const { location, pois, isLoading: isMapLoading, error: locationError, refresh: refreshLocation } = useLocation({
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
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary-container">
            Safira dashboard
          </p>
          <h1 className="break-words font-serif text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Welcome back, <span className="text-primary-container">{user?.fullName || 'there'}</span>
          </h1>
          <p className="mt-2 text-sm text-ink-muted sm:text-base">
            A snapshot of your safety tools, trusted contacts and local information.
          </p>
        </div>
        <div className={`w-fit rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide ${setupReady ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
          Level 1 · {!setupStatusAvailable ? 'Status unavailable' : setupReady ? 'Setup ready' : 'Setup incomplete'}
        </div>
      </header>

      {dashboardError && (
        <p role="status" className="mb-5 rounded-xl border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
          {dashboardError} Some dashboard indicators may be incomplete.
        </p>
      )}

      <section aria-label="Your location and nearby support" className="card-premium mb-6 overflow-hidden !p-0 sm:mb-8">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <MapPin className="h-6 w-6 shrink-0 text-primary-container" />
            <div className="min-w-0">
              <h2 className="font-serif text-xl font-bold text-ink">Your location & nearby support</h2>
              <p className="mt-1 break-words text-xs text-ink-muted">
                {isMapLoading
                  ? 'Finding your location and mapped support points…'
                  : locationError?.includes('showing Delhi')
                    ? 'Location access is unavailable · showing the default Delhi map area'
                    : `Current location · ${location[0].toFixed(4)}, ${location[1].toFixed(4)}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={refreshLocation}
            disabled={isMapLoading}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-canvas px-4 text-sm font-bold text-primary-container transition-colors hover:bg-soft disabled:opacity-60 sm:w-auto"
          >
            <RefreshCw className={`h-4 w-4 ${isMapLoading ? 'animate-spin' : ''}`} />
            {isMapLoading ? 'Locating…' : 'Refresh location'}
          </button>
        </div>
        <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
          <div className="relative h-[16rem] bg-canvas sm:h-[20rem]">
            {isMapLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary-container" />
                <p className="text-sm font-medium text-ink-muted">Loading nearby map…</p>
              </div>
            ) : (
              <CustomMapContainer location={location} pois={pois} />
            )}
          </div>
          <div className="min-w-0 border-t border-line p-4 sm:p-5 lg:border-l lg:border-t-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-ink">Nearby mapped support</h3>
                <p className="mt-1 text-xs text-ink-muted">{isMapLoading ? 'Loading places…' : `${pois.length} places in this view`}</p>
              </div>
              <Link to="/map" className="shrink-0 rounded-lg px-3 py-2 text-sm font-bold text-primary-container hover:bg-soft">
                Open map
              </Link>
            </div>
            {isMapLoading ? (
              <div className="flex items-center gap-2 py-5 text-sm text-ink-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Finding nearby points…
              </div>
            ) : pois.length ? (
              <ul className="divide-y divide-line">
                {pois.slice(0, 4).map((place) => (
                  <li key={place.id} className="flex min-w-0 items-center justify-between gap-3 py-3 first:pt-1">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-container/10 text-primary-container">
                        <MapPin className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{place.name}</p>
                        <p className="text-xs text-ink-muted">{place.type}</p>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-ink-muted">{place.distance}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-canvas p-4 text-sm text-ink-muted">
                {locationError || 'No mapped support points were found nearby.'}
              </p>
            )}
            {locationError && !locationError.includes('showing Delhi') && (
              <p role="status" className="mt-3 text-xs leading-relaxed text-warning">{locationError}</p>
            )}
            <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
              Map points come from available geographic data and are not independently verified as safe.
            </p>
          </div>
        </div>
      </section>

      {activeSosCount > 0 && (
        <section role="alert" className="mb-6 flex flex-col gap-3 rounded-2xl border border-error/20 bg-error/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-bold text-error">
              {activeSosCount} active SOS record{activeSosCount === 1 ? '' : 's'}
            </p>
            <p className="text-sm text-error">Review your SOS status and resolve it when appropriate.</p>
          </div>
          <Link to="/sos" className="inline-flex items-center gap-2 self-start rounded-lg bg-error px-4 py-2 text-sm font-bold text-white hover:bg-error sm:self-auto">
            Open SOS <ArrowUpRight className="h-4 w-4" />
          </Link>
        </section>
      )}

      <section aria-label="Level 1 safety setup" className="card-premium mb-6 grid gap-6 p-5 sm:mb-8 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)] sm:p-6">
        <div>
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-container/10 text-primary-container">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-serif text-xl font-bold text-ink">Level 1 safety setup</h2>
              <p className="text-xs text-ink-muted">Account setup indicators, not a safety guarantee.</p>
            </div>
          </div>
          <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
            {setupReady
              ? 'Live tracking is on and you have at least one verified active trusted contact.'
              : 'Turn on live tracking and add a verified trusted contact to complete these setup indicators.'}
          </p>
        </div>
        <div className="space-y-4 rounded-xl bg-canvas p-4">
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
          color="bg-info/10 text-info"
        />
        <StatCard
          icon={Bell}
          label="SOS records"
          value={isLoading || sosHistory === null ? '—' : sosHistory.length}
          detail={sosHistory === null
            ? 'Status unavailable'
            : activeSosCount ? `${activeSosCount} currently active` : 'No active SOS records'}
          color="bg-soft text-primary"
        />
        <StatCard
          icon={MapPin}
          label="Mapped locations"
          value={isMapLoading ? '—' : pois.length}
          detail="Nearby support places shown"
          color="bg-success/10 text-success"
        />
      </section>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3 lg:gap-6">
        <div className="min-w-0 space-y-5 lg:col-span-2 lg:space-y-6">
          <section className="card-premium p-5 sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Newspaper className="h-5 w-5 shrink-0 text-primary-container" />
                <div>
                  <h2 className="font-serif text-lg font-bold text-ink">Positive current affairs</h2>
                  <p className="text-xs text-ink-muted">Keyword-screened headlines from an external feed</p>
                </div>
              </div>
              <Link to="/current-affairs" aria-label="Open current affairs" className="shrink-0 text-primary-container">
                <ArrowUpRight className="h-5 w-5" />
              </Link>
            </div>
            {newsError ? (
              <div className="rounded-xl bg-warning/10 p-4 text-sm text-warning">
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
              <div className="flex items-center gap-2 py-4 text-sm text-ink-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading headlines…
              </div>
            ) : news.items.length === 0 ? (
              <p className="rounded-xl bg-canvas p-4 text-sm text-ink-muted">
                No headlines matched the positive-content filter. Try again later.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {news.items.slice(0, 3).map((item) => (
                  <li key={item.url} className="py-3 first:pt-1 last:pb-1">
                    <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold leading-snug text-ink hover:text-primary-container">
                      {item.title}
                    </a>
                    <p className="mt-1 text-xs text-ink-muted">
                      {item.source}{item.publishedAt ? ` · ${formatDate(item.publishedAt)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
              {news?.sourceName || 'External news feed'}
              {news?.fetchedAt ? ` · Updated ${formatDate(news.fetchedAt)}` : ''}
              {' · Headlines are keyword-screened and are not Safira alerts or independently verified.'}
            </p>
          </section>

          <section className="card-premium p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <Heart className="h-5 w-5 text-primary-container" />
              <div>
                <h2 className="font-serif text-lg font-bold text-ink">Wellness guide of the day</h2>
                <p className="text-xs text-ink-muted">A daily selection from the Safira wellness library</p>
              </div>
            </div>
            <div className="rounded-xl bg-canvas p-4 sm:p-5">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-primary-container">{wellnessGuide.category}</p>
              <h3 className="font-serif text-lg font-bold text-ink">{wellnessGuide.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{wellnessGuide.desc}</p>
              <Link to="/wellness" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary-container hover:text-primary-container">
                Browse wellness guides <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </section>
        </div>

        <aside className="min-w-0">
          <section className="card-premium p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <Clock className="h-5 w-5 text-primary-container" />
              <h2 className="font-serif text-lg font-bold text-ink">Recent activity</h2>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-ink-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
              </div>
            ) : activities === null ? (
              <p className="py-8 text-center text-sm text-warning">Activity is temporarily unavailable.</p>
            ) : activities.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-muted">No recent activity to show.</p>
            ) : (
              <ul className="space-y-5">
                {activities.slice(0, 5).map((activity, index) => (
                  <li key={activity._id || `${activity.action}-${activity.timestamp}-${index}`} className="flex gap-3">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary-container ring-4 ring-primary-container/10" />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold capitalize text-ink">
                        {(activity.action || 'Activity').replaceAll('_', ' ')}
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">{formatRelativeTime(activity.timestamp)}</p>
                      <p className="mt-1 text-xs text-primary-container">
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
