import React from 'react';
import { getFacilityStrip, getStripLevel } from '../../utils/routeCardModel';

// "Mapped help nearby": police, hospitals/clinics, pharmacies (and mapped 24/7 places) along a route.
// DISPLAY ONLY: not a safety rating and never an input to score, confidence or ranking. One blue
// ramp (darker = more mapped records); the SAME scale is used on every route card so the strips can
// be compared. A grey hatched cell means "none MAPPED within 1 km", which is not proof none exist.
const LEVEL_CLASSES = [
  'bg-line',                       // 0: none mapped
  'bg-primary-container/25',
  'bg-primary-container/50',
  'bg-primary-container/75',
  'bg-primary-container',
];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function FacilityStrip({ route, sharedMax }) {
  const strip = getFacilityStrip(route);
  if (strip.cells.length === 0) return null;
  const { totals } = strip;
  const summary = `Mapped help along this route within 1 km: ${plural(totals.police, 'police station')}, `
    + `${plural(totals.hospital, 'hospital or clinic')}, ${plural(totals.pharmacy, 'pharmacy')}`
    + `${totals.open24x7 === null ? '' : `, ${totals.open24x7} tagged 24/7`}. `
    + `${strip.segmentsWithHelp} of ${strip.cells.length} route sections have at least one.`;

  return (
    <div className="space-y-1.5 rounded-lg border border-line bg-canvas p-2" aria-label="Mapped help nearby">
      <p className="text-[10px] font-black uppercase tracking-widest text-ink-muted">Mapped help nearby</p>
      <div className="flex h-3 w-full gap-px overflow-hidden rounded-full" role="img" aria-label={summary}>
        {strip.cells.map((cell, index) => (
          <div
            key={index}
            className={`h-full flex-1 ${LEVEL_CLASSES[getStripLevel(cell.total, sharedMax)]}`}
            title={`Section ${index + 1}: ${cell.total === 0
              ? 'none mapped within 1 km'
              : `${plural(cell.police, 'police')}, ${plural(cell.hospital, 'hospital/clinic')}, ${plural(cell.pharmacy, 'pharmacy')} within 1 km`}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-ink-muted" aria-hidden="true">
        <span>Start</span>
        <span className="flex items-center gap-1">
          none mapped
          {LEVEL_CLASSES.map((cls, level) => (
            <span key={level} className={`inline-block h-2 w-3 rounded-sm ${cls}`} />
          ))}
          more
        </span>
        <span>End</span>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-muted">
        <li><span className="font-semibold text-ink">{totals.police}</span> police</li>
        <li><span className="font-semibold text-ink">{totals.hospital}</span> hospital/clinic</li>
        <li><span className="font-semibold text-ink">{totals.pharmacy}</span> pharmacy</li>
        {totals.open24x7 !== null && (
          <li><span className="font-semibold text-ink">{totals.open24x7}</span> tagged 24/7</li>
        )}
      </ul>
      <p className="text-[9px] leading-snug text-ink-muted">
        Mapped records within 1 km (straight-line), same colour scale on every route. Not a safety rating.
      </p>
    </div>
  );
}
