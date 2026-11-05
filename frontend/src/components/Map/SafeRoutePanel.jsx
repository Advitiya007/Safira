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
      <label htmlFor="route-destination" className="block text-xs font-bold uppercase tracking-wider text-[#6B5B6B]">
        Safe Route Navigation
      </label>
      <label htmlFor="route-city" className="block text-[11px] font-semibold text-gray-600">City</label>
      <select
        id="route-city"
        value={cityId}
        onChange={(event) => onCityChange(event.target.value)}
        className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm text-[#2D1B2E]"
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
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-2 text-[10px] leading-relaxed text-gray-700">
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
            <div className="text-rose-700">Import message: {selectedCity.featureImportMessage}</div>
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
        <p className="rounded-lg bg-amber-50 p-2 text-[10px] leading-relaxed text-amber-800">
          {selectedCity.featureImportStatus === 'failed'
            ? 'The latest geographic data import failed.'
            : selectedCity.featureImportStatus === 'imported'
              ? 'The import completed but did not find mapped features in this configured coverage.'
              : 'No geographic features have been imported for this configured coverage yet.'}
          {' '}Route analysis requires imported geographic feature data.
        </p>
      )}
      {selectedCity?.verificationStatus === 'prototype' && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] leading-relaxed text-amber-900">
          Prototype study area only — this is not an official municipal boundary.
          {selectedCity.boundarySource && <> Source: {selectedCity.boundarySource}.</>}
          {selectedCity.verificationNotes && <> {selectedCity.verificationNotes}</>}
        </p>
      )}
      {selectedCity?.boundaryAvailable && selectedCity.verificationStatus === 'verified' && selectedCity.boundarySourceType !== 'osm' && (
        <p className="rounded-lg bg-blue-50 p-2 text-[10px] leading-relaxed text-blue-900">
          Boundary type: {selectedCity.boundaryType || 'city boundary'}. Source: {selectedCity.boundarySource || 'external dataset'}.
          {selectedCity.boundaryLicense && <> License: {selectedCity.boundaryLicense}.</>}
        </p>
      )}
      <label htmlFor="route-origin" className="block text-[11px] font-semibold text-gray-600">
        Starting location
      </label>
      <div className="relative">
        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          id="route-origin"
          value={originText}
          onChange={(event) => onOriginTextChange(event.target.value)}
          placeholder={originPoint?.name || 'Use my current location'}
          className="w-full rounded-xl border border-transparent bg-gray-50 py-3 pl-12 pr-4 text-sm font-medium text-[#2D1B2E] outline-none transition-all focus:border-[#8B4A6A] focus:bg-white"
        />
      </div>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          id="route-destination"
          value={destinationText}
          onChange={(event) => onDestinationTextChange(event.target.value)}
          placeholder="Enter a destination..."
          className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-[#8B4A6A] transition-all outline-none text-sm font-medium text-[#2D1B2E]"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold text-gray-600">
          Travel mode
          <select
            value={mode}
            onChange={(event) => onModeChange(event.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm text-[#2D1B2E]"
          >
            <option value="walking">Walking</option>
            <option value="driving">Driving</option>
          </select>
        </label>
        <label className="text-[11px] font-semibold text-gray-600">
          Depart at
          <input
            type="datetime-local"
            value={departureTime}
            onChange={(event) => onDepartureTimeChange(event.target.value)}
            className="mt-1 w-full min-w-0 rounded-xl border border-gray-100 bg-gray-50 px-2 py-2.5 text-xs text-[#2D1B2E]"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={isRouting || isLoadingGeo}
        className="w-full flex items-center justify-center gap-2 py-3 bg-[#8B4A6A] text-white rounded-xl text-sm font-bold hover:bg-[#713a56] disabled:opacity-60"
      >
        {isRouting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Route className="w-4 h-4" />}
        {isRouting ? 'Finding routes…' : 'Find safer routes'}
      </button>
      <p className="text-[11px] leading-relaxed text-gray-500">
        Routes are scored from mapped OSM indicators and nearby facilities. Scores are estimates, not a safety guarantee.
      </p>
      {originPoint && (
        <button
          type="button"
          onClick={onClearOrigin}
          className="flex items-center gap-1 text-xs font-semibold text-[#8B4A6A]"
        >
          <X className="h-3 w-3" /> Use current location as start
        </button>
      )}
      {destination && (
        <button
          type="button"
          onClick={onClearDestination}
          className="flex items-center gap-1 text-xs font-semibold text-[#8B4A6A]"
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
        <div role="alert" className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs font-semibold text-red-700">
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
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-[#8B4A6A]/20 bg-[#8B4A6A]/5 text-[#6B3A58]'
              }`}
            >
              {routeMetadata.recommendationMessage}
            </div>
          )}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#6B5B6B]">Route alternatives</p>
            <p className="mt-1 text-[11px] text-gray-500">
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
                className={`w-full rounded-2xl border p-4 text-left transition-colors ${isSelected ? 'border-[#8B4A6A] bg-[#8B4A6A]/5' : 'border-gray-100 hover:border-[#8B4A6A]/50'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-bold text-sm text-[#2D1B2E]">
                    {hasScore && index === recommendedRouteIndex ? 'Recommended · ' : ''}Route {index + 1}
                  </span>
                  {hasScore ? (
                    <span className="rounded-full bg-[#8B4A6A]/10 px-2 py-1 text-[10px] font-black text-[#8B4A6A]">
                      {route.score}/100 mapped-indicator score
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-gray-500">Indicators unavailable</span>
                  )}
                </div>
                <div className="mt-2 flex gap-4 text-xs font-semibold text-gray-600">
                  <span>{(route.distanceMeters / 1000).toFixed(1)} km</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {Math.round(route.durationSeconds / 60)} min
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] font-semibold text-gray-600">
                    Data confidence: {route.confidence}% · {route.scoredSegmentCoveragePercent}% of distance had at least one scored indicator
                  </p>
                  {route.indicators && (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-gray-50 p-2 text-[10px] text-gray-600">
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
                      <div className="col-span-2 flex justify-between gap-2 border-t border-gray-200 pt-1">
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
                    <p className="text-[11px] font-semibold text-[#6B3A58]">{route.rankingReason}</p>
                  )}
                  <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-gray-600">
                    {route.explanations.map((explanation) => <li key={explanation}>{explanation}</li>)}
                  </ul>
                </div>
              </button>
            );
          })}
          <p className="text-[10px] leading-relaxed text-gray-500">
            The mapped-indicator score uses the full mode-specific weights; unknown indicators add no positive evidence and are not treated as proof of danger. Emergency distance is straight-line, not a measure of road-network access. Confidence is separate. This is not a crime-risk prediction or a safety guarantee.
          </p>
          {routeMetadata?.scoringWeights && (
            <p className="text-[10px] leading-relaxed text-gray-500">
              Configured indicator weights: {Object.entries(routeMetadata.scoringWeights)
                .map(([indicator, weight]) => `${SCORE_LABELS[indicator] || indicator} ${Math.round(weight * 100)}%`)
                .join(' · ')}.
            </p>
          )}
          {routeMetadata?.osmDataTimestamp && (
            <p className="text-[10px] text-gray-500">
              OSM feature data timestamp: {new Date(routeMetadata.osmDataTimestamp).toLocaleDateString()}
            </p>
          )}
          {routeMetadata?.dataCoverage && (
            <div className="space-y-1 text-[10px] text-gray-500">
              <p>
                Imported OSM features: {routeMetadata.dataCoverage.featureCount.toLocaleString()} · category counts show mapped records, not data completeness.
              </p>
              <p>
                {Object.entries(routeMetadata.dataCoverage.coverage || {})
                  .map(([category, count]) => `${category}: ${count}`)
                  .join(' · ') || 'No category coverage reported'}
              </p>
              {routeMetadata.dataCoverage.featureQueryTruncated && (
                <p className="font-semibold text-amber-700">Route data query reached its record limit; results may be incomplete.</p>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
