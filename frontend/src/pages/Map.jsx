import React, { useEffect, useRef, useState } from 'react';
import {
  Search,
  Shield,
  MapPin,
  Phone,
  Navigation,
  Filter,
  Star,
  Hospital,
  ShieldAlert,
  Info,
  Loader2,
  Route,
  XCircle,
  ChevronLeft,
ChevronRight
  //  ChevronRight
} from 'lucide-react';
import CustomMapContainer from '../components/Map/MapContainer';
import { SafeRouteAlternatives, SafeRouteControls } from '../components/Map/SafeRoutePanel';
import useLocation from '../hooks/useLocation';
import { getSafeRoutes, geocodeDestination } from '../utils/safeRoutes';
import { safeRouteAPI } from '../utils/api';

const FILTERS = [
  { label: 'All', icon: Shield },
  { label: 'Police', icon: ShieldAlert },
  { label: 'Hospital', icon: Hospital },
  { label: 'Public Place', icon: Star }
];

const getLocalDateTime = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

export default function MapPage() {
  const { location, pois, isLoading: isLoadingGeo, error, refresh } = useLocation({ radius: 5000, maxEach: 6 });
  const [mapCenter, setMapCenter] = useState(null);
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlaceId, setSelectedPlaceId] = useState(null);
  const [destinationText, setDestinationText] = useState('');
  const [destination, setDestination] = useState(null);
  const [originText, setOriginText] = useState('');
  const [originPoint, setOriginPoint] = useState(null);
  const [cities, setCities] = useState([]);
  const [cityId, setCityId] = useState('');
  const [mode, setMode] = useState('walking');
  const [departureTime, setDepartureTime] = useState(getLocalDateTime);
  const [routeMetadata, setRouteMetadata] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(null);
  const [recommendedRouteIndex, setRecommendedRouteIndex] = useState(null);
  const [isRouting, setIsRouting] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [showCommunityAlert, setShowCommunityAlert] = useState(true);
  const routeRequest = useRef(null);
  const cityLookupStarted = useRef(false);
const filterScrollRef = useRef(null);
const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);


  useEffect(() => {
    const controller = new AbortController();
    safeRouteAPI.getCities(controller.signal)
      .then((response) => {
        if (!response.success || !Array.isArray(response.data)) {
          throw new Error(response.message || 'Supported cities could not be loaded');
        }
        setCities(response.data);
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setRouteError(requestError.message || 'Supported cities could not be loaded');
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (isLoadingGeo || cityLookupStarted.current || !location) return;
    cityLookupStarted.current = true;
    const controller = new AbortController();
    safeRouteAPI.locateCity(location[0], location[1], controller.signal)
      .then((response) => {
        if (response.success && response.data?.cityId) {
          setCityId((currentCityId) => currentCityId || response.data.cityId);
        }
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') console.warn('Automatic city selection failed:', requestError);
      });
  }, [isLoadingGeo, location]);

  // Show toast when there's a location error
  const handleRefresh = () => {
    refresh();
  };

  // Use mapCenter (when user clicks a place) or the geolocated position
  const center = mapCenter || location;

  const filteredPois = pois.filter(p => {
    const matchesFilter = activeFilter === 'All' || p.type.toLowerCase().includes(activeFilter.toLowerCase());
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const clearRoutes = () => {
    routeRequest.current?.abort();
    routeRequest.current = null;
    setRoutes([]);
    setSelectedRouteIndex(null);
    setRecommendedRouteIndex(null);
    setRouteMetadata(null);
    setRouteError('');
    setIsRouting(false);
  };

  const displayRoutes = (analysis) => {
    setRoutes(analysis.routes);
    const bestIndex = Number.isInteger(analysis.recommendedRouteIndex)
      ? analysis.recommendedRouteIndex
      : null;
    setRecommendedRouteIndex(bestIndex);
    setSelectedRouteIndex(bestIndex ?? 0);
    setRouteMetadata(analysis);
  };

  const handleDestinationSearch = async (event) => {
    event.preventDefault();
    if (!destinationText.trim()) {
      setRouteError('Enter a destination to search.');
      return;
    }
    if (!cityId) {
      setRouteError('Select a supported city before requesting a route.');
      return;
    }
    if (!Number.isFinite(new Date(departureTime).getTime())) {
      setRouteError('Choose a valid departure date and time.');
      return;
    }

    routeRequest.current?.abort();
    const controller = new AbortController();
    routeRequest.current = controller;
    setIsRouting(true);
    setRouteError('');
    setRoutes([]);
    setSelectedRouteIndex(null);
    setRecommendedRouteIndex(null);
    try {
      const query = destinationText.trim();
      const isSelectedDestination = destination && (
        query === destination.name ||
        query === `${destination.lat.toFixed(5)}, ${destination.lon.toFixed(5)}`
      );
      const result = isSelectedDestination
        ? destination
        : await geocodeDestination(query, controller.signal);
      setDestination(result);
      setDestinationText(result.name);
      setMapCenter([result.lat, result.lon]);
      setSelectedPlaceId(null);
      let selectedOrigin = originPoint;
      if (originText.trim() && (!selectedOrigin || originText.trim() !== selectedOrigin.name)) {
        selectedOrigin = await geocodeDestination(originText.trim(), controller.signal);
        setOriginPoint(selectedOrigin);
        setOriginText(selectedOrigin.name);
      }
      const originCoordinates = selectedOrigin
        ? [selectedOrigin.lat, selectedOrigin.lon]
        : location;
      const analysis = await getSafeRoutes(originCoordinates, result, controller.signal, {
        cityId,
        mode,
        departureTime: new Date(departureTime).toISOString(),
      });
      displayRoutes(analysis);
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        console.error('Destination routing failed:', requestError);
        setRouteError(requestError.message || 'Unable to find routes right now.');
      }
    } finally {
      if (routeRequest.current === controller) {
        routeRequest.current = null;
        setIsRouting(false);
      }
    }
  };

  const selectDestination = (place) => {
    routeRequest.current?.abort();
    routeRequest.current = null;
    setDestination({ lat: place.lat, lon: place.lon, name: place.name });
    setDestinationText(place.name);
    setMapCenter([place.lat, place.lon]);
    setSelectedPlaceId(place.id);
    setRoutes([]);
    setSelectedRouteIndex(null);
    setRecommendedRouteIndex(null);
    setRouteMetadata(null);
    setRouteError('');
    setIsRouting(false);
  };

  const handleMapDestination = (point) => {
    routeRequest.current?.abort();
    routeRequest.current = null;
    setDestination(point);
    setDestinationText(`${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`);
    setSelectedPlaceId(null);
    setRoutes([]);
    setSelectedRouteIndex(null);
    setRecommendedRouteIndex(null);
    setRouteMetadata(null);
    setRouteError('');
    setIsRouting(false);
  };

  const selectedRoute = selectedRouteIndex === null ? null : routes[selectedRouteIndex];
  const selectedCity = cities.find((city) => city.cityId === cityId);
  const routeFacilities = selectedRoute?.facilities || [];
  const routeOrigin = originPoint
    ? [originPoint.lat, originPoint.lon]
    : location;

  return (
    <div className="min-h-[calc(100dvh-136px)] flex flex-col bg-card lg:h-[calc(100dvh-72px)] lg:min-h-0 lg:flex-row lg:overflow-hidden">

      {/* Toast Notification for Default Location */}
      {error && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[2000] bg-card text-ink border border-line px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4">
          <Info className="w-5 h-5 text-warning" />
          <span className="font-label text-sm font-semibold">{error}</span>
        </div>
      )}

      {/* Sidebar: Search & Places */}
    <aside
  className={`relative order-first w-full min-h-0 flex flex-col bg-card z-20 shadow-xl
    order-last lg:order-first lg:h-full lg:flex-shrink-0 lg:overflow-hidden lg:border-r lg:border-line lg:shadow-none
    transition-[width] duration-300 ease-in-out
    ${isSidebarExpanded
      ? 'lg:w-[600px] lg:max-w-[60vw]'
      : 'lg:w-[480px] lg:max-w-[45vw]'
    }`}
>
  <button
  type="button"
  onClick={() => setIsSidebarExpanded(prev => !prev)}
  className="hidden lg:flex absolute -right-4 top-1/2 -translate-y-1/2
    z-[100] h-16 w-8 items-center justify-center
    rounded-r-lg bg-primary-container text-white shadow-lg
    hover:bg-primary transition-colors"
  aria-label={isSidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
  title={isSidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
>
  {isSidebarExpanded ? (
    <ChevronLeft size={22} />
  ) : (
    <ChevronRight size={22} />
  )}
</button>
  {/* <div className="safety-map-scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain"> */}
      {/* <div className="safety-map-scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain"> */}
        <div className="safety-map-scroll-area min-h-0 flex-none overflow-visible lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
        {/* <div className="p-4 lg:p-6 border-b border-line space-y-4 lg:space-y-6 flex-shrink-0"> */}
        <div className="p-4 lg:p-6 border-b border-line space-y-4 lg:space-y-6 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold font-serif text-ink">Safety Explorer</h2>
              <p className="mt-1 text-sm text-ink-muted">Search a destination or choose a point on the map.</p>
            </div>
            {/* Sidebar location button */}
            <button
              onClick={handleRefresh}
              type="button"
              disabled={isLoadingGeo}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-primary-container/10 px-3 text-sm font-bold text-primary-container transition-colors hover:bg-primary-container/20 disabled:opacity-60"
              aria-label="Refresh my location"
              title="Refresh my location"
            >
              <Navigation className="h-4 w-4 fill-current" />
              <span>{isLoadingGeo ? 'Locating…' : 'My location'}</span>
            </button>
          </div>
          <div className="rounded-xl border border-primary-container/20 bg-primary-container/5 p-3">
            <div className="flex items-center gap-2 text-sm font-bold text-ink">
              <MapPin className="h-4 w-4 shrink-0 text-primary-container" />
              <span>{error?.includes('showing Delhi') ? 'Showing default Delhi map area' : 'Starting point'}</span>
            </div>
            <p className="mt-1 pl-6 text-xs leading-relaxed text-ink-muted">
              {isLoadingGeo
                ? 'Finding your current location…'
                : error?.includes('showing Delhi')
                  ? 'Location access is unavailable. Edit the starting location below or choose a point on the map.'
                  : `Using your current location${location ? ` · ${location[0].toFixed(4)}, ${location[1].toFixed(4)}` : ''}. You can enter a different start below.`}
            </p>
          </div>

          <SafeRouteControls
            cities={cities}
            cityId={cityId}
            selectedCity={selectedCity}
            onCityChange={(value) => {
              setCityId(value);
              clearRoutes();
            }}
            originText={originText}
            onOriginTextChange={setOriginText}
            originPoint={originPoint}
            onClearOrigin={() => {
              setOriginPoint(null);
              setOriginText('');
            }}
            destinationText={destinationText}
            onDestinationTextChange={setDestinationText}
            destination={destination}
            onClearDestination={() => {
              setDestination(null);
              setDestinationText('');
              clearRoutes();
            }}
            mode={mode}
            onModeChange={(value) => {
              setMode(value);
              clearRoutes();
            }}
            departureTime={departureTime}
            onDepartureTimeChange={(value) => {
              setDepartureTime(value);
              clearRoutes();
            }}
            onSubmit={handleDestinationSearch}
            isRouting={isRouting}
            isLoadingGeo={isLoadingGeo}
          />

          {/* <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
            <label htmlFor="nearby-place-filter" className="sr-only">Filter nearby places by name</label>
            <input
              type="text"
              id="nearby-place-filter"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Filter nearby places..."
              className="min-h-12 w-full pl-12 pr-4 py-3 bg-canvas border border-line rounded-xl focus:bg-card focus:border-primary-container transition-all outline-none text-base font-medium text-ink"
            />
          </div>

<div className="safety-filter-scroll flex gap-2 overflow-x-auto pb-3">
              {FILTERS.map(f => (
              <button
                key={f.label}
                onClick={() => setActiveFilter(f.label)}
                className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${activeFilter === f.label
                    ? 'bg-primary-container text-white shadow-lg'
                    : 'bg-soft text-ink-muted hover:bg-soft'
                  }`}
              >
                <f.icon className="w-3.5 h-3.5" />
                {f.label}
              </button>
            ))}
          </div>
        </div> */}




<div className="relative">
  {/* Horizontally scrollable filter categories */}
  <div
    ref={filterScrollRef}
    className="flex gap-2 overflow-x-auto scrollbar-hide scroll-smooth pr-10"
  >
    {FILTERS.map((f) => (
      <button
        key={f.label}
        onClick={() => setActiveFilter(f.label)}
        className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
          activeFilter === f.label
            ? 'bg-primary-container text-white shadow-lg'
            : 'bg-soft text-ink-muted hover:bg-soft'
        }`}
      >
        <f.icon className="w-3.5 h-3.5" />
        {f.label}
      </button>
    ))}
  </div>

  {/* Right-side extender button */}
  <button
    type="button"
    onClick={() =>
      filterScrollRef.current?.scrollBy({
        left: 150,
        behavior: 'smooth'
      })
    }
    className="absolute right-0 top-1/2 -translate-y-1/2 z-10
               flex items-center justify-center w-8 h-8
               rounded-full bg-white shadow-md border border-line
               text-primary-container hover:bg-soft transition-all"
    aria-label="Show more filter categories"
  >
    <ChevronRight className="w-5 h-5" />
  </button>
</div>
</div>
      <div className="p-4 space-y-5 lg:p-6 lg:space-y-6">
          <SafeRouteAlternatives
            routeError={routeError}
            routes={routes}
            selectedRouteIndex={selectedRouteIndex}
            recommendedRouteIndex={recommendedRouteIndex}
            onSelectRoute={setSelectedRouteIndex}
            mode={mode}
            cityName={selectedCity?.name}
            routeMetadata={routeMetadata}
          />

          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-ink-muted">
              Nearby mapped support · {filteredPois.length}
            </p>
            <Filter className="w-4 h-4 text-ink-muted cursor-pointer" />
          </div>

          <div className="space-y-4">
            {isLoadingGeo ? (
              <div className="text-center py-10 px-4">
                <Loader2 className="w-8 h-8 text-primary-container mx-auto mb-3 animate-spin" />
                <p className="text-ink-muted font-medium text-sm">Finding safe places near you…</p>
              </div>
            ) : filteredPois.length === 0 ? (
              <div className="text-center py-10 px-4">
                <ShieldAlert className="w-8 h-8 text-ink-muted mx-auto mb-3" />
                <p className="text-ink-muted font-medium text-sm">
                  {searchQuery ? `No results found for "${searchQuery}"` : 'No safe places found nearby'}
                </p>
              </div>
            ) : (
              filteredPois.map((place) => (
                <div
                  key={place.id}
                  onClick={() => {
                    setMapCenter([place.lat, place.lon]);
                    setSelectedPlaceId(place.id);
                  }}
                  className={`group p-4 rounded-2xl border transition-all cursor-pointer ${selectedPlaceId === place.id
                      ? 'border-primary-container bg-primary-container/5'
                      : 'border-line hover:border-primary-container hover:bg-primary-container/5'
                    }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className={`font-bold transition-colors ${selectedPlaceId === place.id ? 'text-primary-container' : 'text-ink group-hover:text-primary-container'}`}>
                      {place.name}
                    </h3>
                    <span className="text-[10px] font-black text-primary-container bg-primary-container/10 px-2 py-0.5 rounded-full whitespace-nowrap ml-2">
                      {place.distance}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1 text-ink-muted font-medium">
                      <Shield className="w-3 h-3" /> {place.type}
                    </span>
                    <span className="text-[10px] text-ink-muted">OpenStreetMap</span>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-[10px] font-bold text-ink-muted italic">{place.status}</p>
                    <div className="flex gap-2">
                      <button
                        className="p-2 bg-card rounded-lg border border-line text-ink-muted hover:text-primary-container shadow-sm transition-colors"
                        onClick={(e) => { e.stopPropagation(); /* handle call */ }}
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                      <button
                        className="p-2 bg-primary-container rounded-lg text-white shadow-md hover:shadow-lg transition-all"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectDestination(place);
                        }}
                        title="Set as route destination"
                      >
                        <Route className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        </div>
{/*  */}
        {showCommunityAlert && (
          <div className="relative flex-shrink-0 border-t border-line bg-ink px-4 py-2.5 pr-11 text-white lg:px-5">
            <div className="flex items-center gap-2.5">
              <Shield className="h-4 w-4 flex-shrink-0 text-primary-container" />
              <p className="min-w-0 text-[11px] leading-snug">
                <span className="mr-1.5 font-bold uppercase tracking-wider text-primary-container">Community alert</span>
                <span className="opacity-80">OSM map data does not verify an area as safe.</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCommunityAlert(false)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/70 transition-colors hover:bg-card/10 hover:text-white"
              aria-label="Dismiss community alert"
              title="Dismiss alert"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        )}
      </aside>

      {/* Main Content: Map */}
      {/* <main className="relative order-last h-[40dvh] min-h-[240px] max-h-[380px] w-full flex-none bg-canvas flex items-center justify-center lg:order-last lg:h-auto lg:max-h-none lg:min-h-0 lg:min-w-0 lg:flex-1"> */}
<main className="relative order-first h-[45dvh] min-h-[280px] max-h-[450px] w-full flex-none bg-canvas flex items-center justify-center lg:order-last lg:h-auto lg:max-h-none lg:min-h-0 lg:min-w-0 lg:flex-1">
        {/* Loading State or Map */}
        {isLoadingGeo ? (
          <div className="flex flex-col items-center gap-4 text-primary-container">
            <Loader2 className="w-10 h-10 animate-spin" />
            <p className="font-bold text-sm animate-pulse">Locating your safe zone...</p>
          </div>
        ) : (
          <div className="absolute inset-0 z-0">
            <CustomMapContainer
              location={center}
              origin={originPoint ? routeOrigin : null}
              originName={originPoint?.name || 'Route start'}
              pois={filteredPois}
              routes={routes}
              selectedRouteIndex={selectedRouteIndex}
              destination={destination}
              routeFacilities={routeFacilities}
              onSelectRoute={setSelectedRouteIndex}
              onSelectDestination={handleMapDestination}
            />
          </div>
        )}

        {/* Floating Map Controls (My Location) */}
        {!isLoadingGeo && (
          <div className="absolute top-8 right-8 z-[1000] flex flex-col gap-4">
            <button
              onClick={() => { setMapCenter(null); handleRefresh(); }}
              className="p-4 bg-card rounded-full shadow-2xl text-primary-container hover:bg-primary-container hover:text-white transition-all group"
              title="Go to My Location"
            >
              <Navigation className="w-6 h-6 group-hover:scale-110 transition-transform" />
            </button>
          </div>
        )}

        {/* SOS Floating Action (Mobile only) */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[1000] w-full max-w-sm px-4 lg:hidden pointer-events-none">
          <button className="w-full bg-error text-white py-4 rounded-2xl flex items-center justify-center gap-3 shadow-2xl animate-pulse pointer-events-auto">
            <ShieldAlert className="w-6 h-6" />
            <span className="text-sm font-bold uppercase tracking-widest">Trigger Emergency SOS</span>
          </button>
        </div>

      </main>
    </div>
  );
}
