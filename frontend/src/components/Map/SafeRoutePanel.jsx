import React, { useState } from 'react';
import { ChevronDown, Clock, Loader2, MapPin, Route, Search, X } from 'lucide-react';
import InfrastructureProfile, {
  InfrastructureProfileDetail,
  InfrastructureProfileNote,
} from './InfrastructureProfile';
import {
  SCORE_LABELS,
  getConfidenceSummary,
  getRecommendationReview,
  splitIndicators,
} from '../../utils/routeCardModel';

export function SafeRouteControls({
  cities,
  cityId,
  selectedCity,
  onCityChange,
  originText,
  onOriginTextChange,
  originPoint,
  onClearOrigin,
  destinationText,
  onDestinationTextChange,
  destination,
  onClearDestination,
  mode,
  onModeChange,
  departureTime,
  onDepartureTimeChange,
  onSubmit,
  isRouting,
  isLoadingGeo,
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-wider text-primary-container">
        Plan a route
      </p>
      <label htmlFor="route-city" className="block text-sm font-semibold text-ink">Choose your city</label>
      <select
        id="route-city"
        value={cityId}
        onChange={(event) => onCityChange(event.target.value)}
        className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink"
      >
        <option value="">Select a supported city</option>
        {cities.map((city) => (
          <option key={city.cityId} value={city.cityId}>
            {city.name}
            {city.dataAvailable
              ? ' · OSM features imported'
              : city.featureImportStatus === 'failed'
                ? ' · last import failed'
                : city.featureImportStatus === 'imported'
                  ? ' · import completed with no features'
                  : ' · geographic data pending'}
          </option>
        ))}
      </select>
      {selectedCity && (
        <div className="rounded-lg border border-line bg-canvas p-2 text-[10px] leading-relaxed text-ink-muted">
          <div className="font-semibold">
            Geographic data: {selectedCity.featureImportStatus || 'pending'}
            {' · '}{(selectedCity.featureCount || 0).toLocaleString()} mapped features
          </div>
          <div>
            Coverage: {Object.entries(selectedCity.coverage || {})
              .map(([category, count]) => `${category} ${Number(count).toLocaleString()}`)
              .join(' · ') || 'No imported category data'}
          </div>
          <div>
            Last imported: {selectedCity.dataImportedAt
              ? new Date(selectedCity.dataImportedAt).toLocaleString()
              : 'not yet imported'}
          </div>
          {selectedCity.latestImport && (
            <div>
              Latest attempt: {selectedCity.latestImport.status}
              {selectedCity.latestImport.startedAt
                ? ` · ${new Date(selectedCity.latestImport.startedAt).toLocaleString()}`
                : ''}
              {selectedCity.latestImport.error?.message
                ? ` · ${selectedCity.latestImport.error.message}`
                : ''}
            </div>
          )}
          {selectedCity.osmDataTimestamp && (
            <div>OSM snapshot: {new Date(selectedCity.osmDataTimestamp).toLocaleString()}</div>
          )}
          {selectedCity.featureImportSource && <div>Source: {selectedCity.featureImportSource}</div>}
          {selectedCity.featureImportMessage && (
            <div className="text-primary">Import message: {selectedCity.featureImportMessage}</div>
          )}
          {selectedCity.boundingBox && (
            <div>
              Configured bounding-box coverage (not an administrative boundary):{' '}
              {selectedCity.boundingBox.south}, {selectedCity.boundingBox.west} to{' '}
              {selectedCity.boundingBox.north}, {selectedCity.boundingBox.east}
            </div>
          )}
        </div>
      )}
      {selectedCity && !selectedCity.dataAvailable && (
        <p className="rounded-lg bg-warning/10 p-2 text-[10px] leading-relaxed text-warning">
          {selectedCity.featureImportStatus === 'failed'
            ? 'The latest geographic data import failed.'
            : selectedCity.featureImportStatus === 'imported'
              ? 'The import completed but did not find mapped features in this configured coverage.'
              : 'No geographic features have been imported for this configured coverage yet.'}
          {' '}Route analysis requires imported geographic feature data.
        </p>
      )}
      {selectedCity?.verificationStatus === 'prototype' && (
        <p className="rounded-lg border border-warning/20 bg-warning/10 p-2 text-[10px] leading-relaxed text-warning">
          Prototype study area only — this is not an official municipal boundary.
          {selectedCity.boundarySource && <> Source: {selectedCity.boundarySource}.</>}
          {selectedCity.verificationNotes && <> {selectedCity.verificationNotes}</>}
        </p>
      )}
      {selectedCity?.boundaryAvailable && selectedCity.verificationStatus === 'verified' && selectedCity.boundarySourceType !== 'osm' && (
        <p className="rounded-lg bg-info/10 p-2 text-[10px] leading-relaxed text-info">
          Boundary type: {selectedCity.boundaryType || 'city boundary'}. Source: {selectedCity.boundarySource || 'external dataset'}.
          {selectedCity.boundaryLicense && <> License: {selectedCity.boundaryLicense}.</>}
        </p>
      )}
      <label htmlFor="route-origin" className="block text-sm font-semibold text-ink">
        Start from
      </label>
      <div className="relative">
        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary-container" />
        <input
          type="text"
          id="route-origin"
          value={originText}
          onChange={(event) => onOriginTextChange(event.target.value)}
          placeholder={originPoint?.name || 'Your current location'}
          autoComplete="street-address"
          className="min-h-12 w-full rounded-xl border border-line bg-canvas py-3 pl-12 pr-4 text-base font-medium text-ink outline-none transition-all focus:border-primary-container focus:bg-card focus:ring-2 focus:ring-primary-container/20"
        />
      </div>
      <p className="-mt-2 text-xs leading-relaxed text-ink-muted">
        Leave blank to use your current location. You can also tap the map to set a destination.
      </p>
      <label htmlFor="route-destination" className="block text-sm font-semibold text-ink">
        Where would you like to go?
      </label>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary-container" />
        <input
          type="text"
          id="route-destination"
          value={destinationText}
          onChange={(event) => onDestinationTextChange(event.target.value)}
          placeholder="Search a place or address"
          autoComplete="street-address"
          className="min-h-12 w-full rounded-xl border border-primary-container/30 bg-canvas py-3 pl-12 pr-4 text-base font-medium text-ink outline-none transition-all placeholder:text-ink-muted focus:border-primary-container focus:bg-card focus:ring-2 focus:ring-primary-container/20"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold text-ink-muted">
          Travel mode
          <select
            value={mode}
            onChange={(event) => onModeChange(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink"
          >
            <option value="walking">Walking</option>
            <option value="driving">Driving</option>
          </select>
        </label>
        <label className="text-[11px] font-semibold text-ink-muted">
          Depart at
          <input
            type="datetime-local"
            value={departureTime}
            onChange={(event) => onDepartureTimeChange(event.target.value)}
            className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-canvas px-2 py-2.5 text-sm text-ink"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={isRouting || isLoadingGeo}
        className="min-h-12 w-full flex items-center justify-center gap-2 bg-primary-container text-white rounded-xl text-base font-bold hover:bg-primary-hover disabled:opacity-60"
      >
        {isRouting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Route className="w-4 h-4" />}
        {isRouting ? 'Finding routes…' : 'Find safer routes'}
      </button>
      <p className="text-[11px] leading-relaxed text-ink-muted">
        Routes are scored from mapped OSM indicators and nearby facilities. Scores are estimates, not a safety guarantee.
      </p>
      {originPoint && (
        <button
          type="button"
          onClick={onClearOrigin}
          className="flex items-center gap-1 text-xs font-semibold text-primary-container"
        >
          <X className="h-3 w-3" /> Use current location as start
        </button>
      )}
      {destination && (
        <button
          type="button"
          onClick={onClearDestination}
          className="flex items-center gap-1 text-xs font-semibold text-primary-container"
        >
          <X className="w-3 h-3" /> Clear destination
        </button>
      )}
    </form>
  );
}

const SECTION_HEADING = 'text-[10px] font-black uppercase tracking-widest text-ink-muted';

function RouteDetails({ id, route, index, routeMetadata, infrastructure }) {
  const minimumConfidence = routeMetadata?.minimumRecommendationConfidence;
  const confidence = getConfidenceSummary(route, minimumConfidence);
  const review = getRecommendationReview(route, index, routeMetadata);
  return (
    <div
      id={id}
      role="region"
      aria-label={`Details for Route ${index + 1}`}
      className="mt-2 space-y-3 rounded-lg bg-canvas p-3 text-[11px] leading-relaxed text-ink-muted"
    >
      <section className="space-y-1">
        <h4 className={SECTION_HEADING}>Recommendation</h4>
        <p className="font-semibold text-ink">{review.headline}</p>
        {review.reason && <p>{review.reason}</p>}
        {review.note && <p>{review.note}</p>}
      </section>

      <section className="space-y-1">
        <h4 className={SECTION_HEADING}>Data confidence{confidence.percent !== null ? `: ${confidence.percent}%` : ''}</h4>
        {confidence.threshold !== null && (
          <p>
            A route needs at least {confidence.threshold}% to be recommended
            {confidence.percent !== null && (confidence.isLow ? '; this route is below that.' : '; this route meets it.')}
          </p>
        )}
        <p>
          Confidence reflects how many indicators had mapped data along the route, how many mapped
          businesses list opening hours, and how recent the map data is.
        </p>
        {confidence.totalCount > 0 && (
          <p>
            Mapped data was found for {confidence.knownCount} of {confidence.totalCount} indicators
            {confidence.coveredDistancePercent !== null
              ? `, covering ${confidence.coveredDistancePercent}% of the route distance with at least one.`
              : '.'}
          </p>
        )}
        {confidence.missingLabels.length > 0 && (
          <p>
            No mapped data on this route for: {confidence.missingLabels.join(', ')}. That lowers confidence;
            it is not evidence that the route is unsafe.
          </p>
        )}
      </section>

      {route.explanations?.length > 0 && (
        <section className="space-y-1">
          <h4 className={SECTION_HEADING}>Route notes</h4>
          <ul className="list-disc space-y-1 pl-4">
            {route.explanations.map((explanation) => <li key={explanation}>{explanation}</li>)}
          </ul>
        </section>
      )}

      <InfrastructureProfileDetail infrastructure={infrastructure} routeId={route.id} />
    </div>
  );
}

export function SafeRouteAlternatives({
  routeError,
  routes,
  selectedRouteIndex,
  recommendedRouteIndex,
  onSelectRoute,
  mode,
  cityName,
  routeMetadata,
  infrastructure,
}) {
  const [openDetailsKey, setOpenDetailsKey] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const analysisKey = String(routeMetadata?.analysisId ?? 'analysis');
  const minimumConfidence = routeMetadata?.minimumRecommendationConfidence;

  return (
    <>
      {routeError && (
        <div role="alert" className="rounded-xl border border-error/20 bg-error/10 p-3 text-xs font-semibold text-error">
          {routeError}
        </div>
      )}
      {routes.length > 0 && (
        <section aria-label="Route alternatives" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className={SECTION_HEADING}>
              Route alternatives · {mode === 'walking' ? 'Walking' : 'Driving'}{cityName ? ` · ${cityName}` : ''}
            </p>
            {routeMetadata?.recommendationStatus === 'insufficient_data' && (
              <span role="status" className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-bold text-warning">
                No route recommended
              </span>
            )}
          </div>
          {routes.map((route, index) => {
            const isSelected = index === selectedRouteIndex;
            const hasScore = Number.isFinite(route.score);
            const { known } = splitIndicators(route.indicators);
            const confidence = getConfidenceSummary(route, minimumConfidence);
            const detailsKey = `${analysisKey}:${route.id}`;
            const detailsId = `route-details-${route.id}`;
            const isOpen = openDetailsKey === detailsKey;
            const showNearestEmergency = route.nearestEmergencyFacilityMeters !== null
              && route.nearestEmergencyFacilityMeters !== undefined;
            return (
              <div
                key={route.id}
                className={`rounded-2xl border p-4 transition-colors ${isSelected ? 'border-primary-container bg-primary-container/5' : 'border-line hover:border-primary-container/50'}`}
              >
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelectRoute(index)}
                  className="block w-full text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-sm text-ink">
                      {hasScore && index === recommendedRouteIndex ? 'Recommended · ' : ''}Route {index + 1}
                    </span>
                    {hasScore && (
                      <span className="rounded-full bg-primary-container/10 px-2 py-1 text-[10px] font-black text-primary-container">
                        {route.score}/100 mapped-indicator score
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-ink-muted">
                    <span>{(route.distanceMeters / 1000).toFixed(1)} km</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {Math.round(route.durationSeconds / 60)} min
                    </span>
                    {confidence.isLow && (
                      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-bold text-warning">
                        Low data confidence
                      </span>
                    )}
                  </div>
                  {(known.length > 0 || showNearestEmergency) && (
                    <dl className="mt-3 grid grid-cols-1 gap-y-1 rounded-lg bg-canvas p-2 text-[10px] text-ink-muted">
                      {known.map(({ key, label, score, coveragePercent }) => (
                        <div key={key} className="flex justify-between gap-2">
                          <dt>{label}</dt>
                          <dd className="text-right font-semibold">{`${score}/100 · ${coveragePercent}%`}</dd>
                        </div>
                      ))}
                      {showNearestEmergency && (
                        <div className="flex justify-between gap-2 border-t border-line pt-1">
                          <dt>Nearest mapped emergency facility</dt>
                          <dd className="text-right font-semibold">{route.nearestEmergencyFacilityMeters} m straight-line</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </button>
                <div className="mt-2 space-y-1">
                  <InfrastructureProfile infrastructure={infrastructure} routeId={route.id} />
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={detailsId}
                    onClick={() => setOpenDetailsKey(isOpen ? null : detailsKey)}
                    className="flex min-h-9 items-center gap-1 text-xs font-bold text-primary-container"
                  >
                    Why this route?
                    <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                  {isOpen && (
                    <RouteDetails
                      id={detailsId}
                      route={route}
                      index={index}
                      routeMetadata={routeMetadata}
                      infrastructure={infrastructure}
                    />
                  )}
                </div>
              </div>
            );
          })}
          <div>
            <button
              type="button"
              aria-expanded={aboutOpen}
              aria-controls="route-analysis-about"
              onClick={() => setAboutOpen((open) => !open)}
              className="flex min-h-9 items-center gap-1 text-[11px] font-bold text-ink-muted"
            >
              About these scores
              <ChevronDown className={`h-3 w-3 transition-transform ${aboutOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {aboutOpen && (
              <div id="route-analysis-about" className="mt-1 space-y-2 text-[10px] leading-relaxed text-ink-muted">
                <p>
                  The mapped-indicator score uses the full mode-specific weights; unknown indicators add no positive evidence and are not treated as proof of danger. Emergency distance is straight-line, not a measure of road-network access. Confidence is separate. This is not a crime-risk prediction or a safety guarantee.
                </p>
                <InfrastructureProfileNote infrastructure={infrastructure} />
                {routeMetadata?.scoringWeights && (
                  <p>
                    Configured indicator weights: {Object.entries(routeMetadata.scoringWeights)
                      .map(([indicator, weight]) => `${SCORE_LABELS[indicator] || indicator} ${Math.round(weight * 100)}%`)
                      .join(' · ')}.
                  </p>
                )}
                {routeMetadata?.osmDataTimestamp && (
                  <p>OSM feature data timestamp: {new Date(routeMetadata.osmDataTimestamp).toLocaleDateString()}</p>
                )}
                {routeMetadata?.dataCoverage && (
                  <>
                    <p>
                      Imported OSM features: {routeMetadata.dataCoverage.featureCount.toLocaleString()} · category counts show mapped records, not data completeness.
                    </p>
                    <p>
                      {Object.entries(routeMetadata.dataCoverage.coverage || {})
                        .map(([category, count]) => `${category}: ${count}`)
                        .join(' · ') || 'No category coverage reported'}
                    </p>
                    {routeMetadata.dataCoverage.featureQueryTruncated && (
                      <p className="font-semibold text-warning">Route data query reached its record limit; results may be incomplete.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
