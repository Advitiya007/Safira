import React from 'react';
import { Layers } from 'lucide-react';

// Shows which unsupervised "infrastructure clusters" a route passes through.
// This is DISPLAY ONLY: it never feeds the route score, confidence or ranking, and the
// wording/colours deliberately avoid safe/unsafe semantics (one neutral hue, darker = more mapped infrastructure).
const LEVEL_STYLES = {
  'Infrastructure-rich': 'bg-primary-container',
  'Moderate infrastructure': 'bg-primary-container/60',
  'Mixed infrastructure': 'bg-primary-container/40',
  'Infrastructure-sparse': 'bg-primary-container/20',
};
const FALLBACK_STYLE = 'bg-primary-container/30';

const UNAVAILABLE_NOTES = {
  // Feature switched off on the server: show nothing rather than a confusing message.
  not_configured: null,
  model_not_trained: 'Infrastructure profile unavailable: no clustering model has been trained yet.',
  no_routes: null,
};
const DEFAULT_UNAVAILABLE_NOTE = 'Infrastructure profile is temporarily unavailable. Route scores above are unaffected.';

const formatPercent = (value) => `${Number(value).toFixed(value >= 10 || value === 0 ? 0 : 1)}%`;

export default function InfrastructureProfile({ infrastructure, routeId }) {
  if (!infrastructure) return null;

  if (infrastructure.status === 'loading') {
    return (
      <p className="text-[10px] text-ink-muted" role="status">
        Loading infrastructure profile…
      </p>
    );
  }

  if (infrastructure.status !== 'ready') {
    const reason = infrastructure.data?.reason;
    const note = reason in UNAVAILABLE_NOTES ? UNAVAILABLE_NOTES[reason] : DEFAULT_UNAVAILABLE_NOTE;
    return note ? <p className="text-[10px] text-ink-muted">{note}</p> : null;
  }

  const { data } = infrastructure;
  const profile = (data.routes || []).find((item) => String(item.routeId) === String(routeId));
  if (!profile) return null;

  const shares = profile.clusterShares || [];
  const matchedPercent = shares.reduce((sum, share) => sum + share.percentOfRoute, 0);
  const notProfiledPercent = Math.max(0, 100 - matchedPercent);
  const dominantInfo = profile.dominantCluster ? data.clusters?.[profile.dominantCluster.clusterId] : null;

  return (
    <div className="space-y-2 rounded-lg border border-line bg-canvas p-2" aria-label="Infrastructure profile">
      <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-ink-muted">
        <Layers className="h-3 w-3" aria-hidden="true" />
        Infrastructure profile
      </div>

      {shares.length === 0 ? (
        <p className="text-[10px] leading-relaxed text-ink-muted">
          No mapped road segments with a cluster assignment were matched to this route, so no profile is shown.
        </p>
      ) : (
        <>
          <div
            className="flex h-2 w-full overflow-hidden rounded-full bg-line"
            role="img"
            aria-label={shares
              .map((share) => `${share.name || `Cluster ${share.clusterId}`} ${formatPercent(share.percentOfRoute)}`)
              .join(', ')}
          >
            {shares.map((share) => (
              <div
                key={share.clusterId}
                className={LEVEL_STYLES[data.clusters?.[share.clusterId]?.level] || FALLBACK_STYLE}
                style={{ width: `${share.percentOfRoute}%` }}
                title={`${share.name}: ${formatPercent(share.percentOfRoute)}`}
              />
            ))}
          </div>
          <ul className="space-y-1 text-[10px] text-ink-muted">
            {shares.map((share) => (
              <li key={share.clusterId} className="flex items-start justify-between gap-2">
                <span className="flex items-start gap-1">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-sm ${LEVEL_STYLES[data.clusters?.[share.clusterId]?.level] || FALLBACK_STYLE}`}
                  />
                  {share.name || `Cluster ${share.clusterId}`}
                </span>
                <span className="font-semibold">{formatPercent(share.percentOfRoute)}</span>
              </li>
            ))}
            {notProfiledPercent >= 1 && (
              <li className="flex items-start justify-between gap-2">
                <span>No mapped road segment matched</span>
                <span className="font-semibold">{formatPercent(notProfiledPercent)}</span>
              </li>
            )}
          </ul>
          {dominantInfo?.description && (
            <p className="text-[10px] leading-relaxed text-ink-muted">
              Most common: <span className="font-semibold">{dominantInfo.name}</span>. {dominantInfo.description}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function InfrastructureProfileNote({ infrastructure }) {
  if (infrastructure?.status !== 'ready') return null;
  const { data } = infrastructure;
  return (
    <p className="text-[10px] leading-relaxed text-ink-muted">
      Infrastructure profiles come from an unsupervised K-Means grouping of mapped OpenStreetMap
      road segments (model {data.modelVersion}). They are shown for context only and do not change
      route scores, confidence or ranking. {data.disclaimer}
    </p>
  );
}
