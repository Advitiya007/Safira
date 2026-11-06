import React from 'react';
import { Clock, Loader2, MapPin, Route, Search, X } from 'lucide-react';

const SCORE_LABELS = {
  nightActivity: 'night-time activity',
  lighting: 'lighting',
  roadAccessibility: 'road access',
  cctv: 'mapped CCTV',
  emergencyAccess: 'emergency proximity',
  publicTransport: 'public transport',
  isolation: 'mapped activity proximity',
};

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

export function SafeRouteAlternatives({
  routeError,
  routes,
  selectedRouteIndex,
  recommendedRouteIndex,
  onSelectRoute,
  mode,
  cityName,
  routeMetadata,
}) {
  return (
    <>
      {routeError && (
        <div role="alert" className="rounded-xl border border-error/20 bg-error/10 p-3 text-xs font-semibold text-error">
          {routeError}
        </div>
      )}
      {routes.length > 0 && (
        <section aria-label="Route alternatives" className="space-y-3">
          {routeMetadata?.recommendationMessage && (
            <div
              role={routeMetadata.recommendationStatus === 'insufficient_data' ? 'status' : 'note'}
              className={`rounded-xl border p-3 text-xs font-semibold ${
                routeMetadata.recommendationStatus === 'insufficient_data'
                  ? 'border-warning/20 bg-warning/10 text-warning'
                  : 'border-primary-container/20 bg-primary-container/5 text-primary'
              }`}
            >
              {routeMetadata.recommendationMessage}
            </div>
          )}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-ink-muted">Route alternatives</p>
            <p className="mt-1 text-[11px] text-ink-muted">
              {mode === 'walking' ? 'Walking' : 'Driving'} alternatives, ranked by mapped indicators for {cityName || 'the selected city'}.
            </p>
          </div>
          {routes.map((route, index) => {
            const isSelected = index === selectedRouteIndex;
            const hasScore = Number.isFinite(route.score);
            return (
              <button
                type="button"
                key={route.id}
                onClick={() => onSelectRoute(index)}
                className={`w-full rounded-2xl border p-4 text-left transition-colors ${isSelected ? 'border-primary-container bg-primary-container/5' : 'border-line hover:border-primary-container/50'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-bold text-sm text-ink">
                    {hasScore && index === recommendedRouteIndex ? 'Recommended · ' : ''}Route {index + 1}
                  </span>
                  {hasScore ? (
                    <span className="rounded-full bg-primary-container/10 px-2 py-1 text-[10px] font-black text-primary-container">
                      {route.score}/100 mapped-indicator score
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-ink-muted">Indicators unavailable</span>
                  )}
                </div>
                <div className="mt-2 flex gap-4 text-xs font-semibold text-ink-muted">
                  <span>{(route.distanceMeters / 1000).toFixed(1)} km</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {Math.round(route.durationSeconds / 60)} min
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] font-semibold text-ink-muted">
                    Data confidence: {route.confidence}% · {route.scoredSegmentCoveragePercent}% of distance had at least one scored indicator
                  </p>
                  {route.indicators && (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-canvas p-2 text-[10px] text-ink-muted">
                      {Object.entries(route.indicators).map(([indicator, value]) => (
                        <div key={indicator} className="flex justify-between gap-2">
                          <dt>{SCORE_LABELS[indicator] || indicator}</dt>
                          <dd className="text-right font-semibold">
                            {value.score === null
                              ? 'Unknown'
                              : `${value.score}/100 · ${value.coveragePercent}% coverage`}
                          </dd>
                        </div>
                      ))}
                      <div className="col-span-2 flex justify-between gap-2 border-t border-line pt-1">
                        <dt>Nearest mapped emergency facility</dt>
                        <dd className="text-right font-semibold">
                          {route.nearestEmergencyFacilityMeters === null
                            ? 'None mapped within 1 km'
                            : `${route.nearestEmergencyFacilityMeters} m straight-line`}
                        </dd>
                      </div>
                    </dl>
                  )}
                  {route.rankingReason && (
                    <p className="text-[11px] font-semibold text-primary">{route.rankingReason}</p>
                  )}
                  <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-ink-muted">
                    {route.explanations.map((explanation) => <li key={explanation}>{explanation}</li>)}
                  </ul>
                </div>
              </button>
            );
          })}
          <p className="text-[10px] leading-relaxed text-ink-muted">
            The mapped-indicator score uses the full mode-specific weights; unknown indicators add no positive evidence and are not treated as proof of danger. Emergency distance is straight-line, not a measure of road-network access. Confidence is separate. This is not a crime-risk prediction or a safety guarantee.
          </p>
          {routeMetadata?.scoringWeights && (
            <p className="text-[10px] leading-relaxed text-ink-muted">
              Configured indicator weights: {Object.entries(routeMetadata.scoringWeights)
                .map(([indicator, weight]) => `${SCORE_LABELS[indicator] || indicator} ${Math.round(weight * 100)}%`)
                .join(' · ')}.
            </p>
          )}
          {routeMetadata?.osmDataTimestamp && (
            <p className="text-[10px] text-ink-muted">
              OSM feature data timestamp: {new Date(routeMetadata.osmDataTimestamp).toLocaleDateString()}
            </p>
          )}
          {routeMetadata?.dataCoverage && (
            <div className="space-y-1 text-[10px] text-ink-muted">
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
            </div>
          )}
        </section>
      )}
    </>
  );
}
