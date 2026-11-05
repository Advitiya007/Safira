import React, { useEffect, useRef, useState } from 'react';
import {
  Search,
  Shield,
  Phone,
  Navigation,
  Filter,
  Star,
  Hospital,
  ShieldAlert,
  Info,
  Loader2,
  Route,
  XCircle
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
    <div className="min-h-[calc(100dvh-136px)] flex flex-col bg-white lg:h-[calc(100dvh-72px)] lg:min-h-0 lg:flex-row lg:overflow-hidden">

      {/* Toast Notification for Default Location */}
      {error && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[2000] bg-gray-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4">
          <Info className="w-5 h-5 text-yellow-400" />
          <span className="font-label text-sm font-semibold">{error}</span>
        </div>
      )}

      {/* Sidebar: Search & Places */}
      <aside className="order-last w-full min-h-0 flex flex-col bg-white z-20 shadow-xl lg:order-first lg:h-full lg:w-[400px] lg:max-w-[40vw] lg:flex-shrink-0 lg:border-r lg:border-gray-100 lg:shadow-none">
        <div className="p-4 lg:p-6 border-b border-gray-100 space-y-4 lg:space-y-6 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold font-serif text-[#2D1B2E]">Safety Explorer</h2>
            {/* Sidebar location button */}
            <button
              onClick={handleRefresh}
              className="p-2 bg-[#8B4A6A]/10 rounded-lg text-[#8B4A6A] hover:bg-[#8B4A6A]/20 transition-colors"
              title="Refresh Location"
            >
              <Navigation className="w-5 h-5 fill-current" />
            </button>
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

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Filter nearby places..."
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-[#8B4A6A] transition-all outline-none text-sm font-medium text-[#2D1B2E]"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {FILTERS.map(f => (
              <button
                key={f.label}
                onClick={() => setActiveFilter(f.label)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${activeFilter === f.label
                    ? 'bg-[#8B4A6A] text-white shadow-lg'
                    : 'bg-gray-100 text-[#6B5B6B] hover:bg-gray-200'
                  }`}
              >
                <f.icon className="w-3.5 h-3.5" />
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 p-4 space-y-5 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:p-6 lg:space-y-6">
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
            <p className="text-[10px] font-black uppercase tracking-widest text-[#6B5B6B]">Nearby Safe Locations</p>
            <Filter className="w-4 h-4 text-gray-400 cursor-pointer" />
          </div>

          <div className="space-y-4">
            {isLoadingGeo ? (
              <div className="text-center py-10 px-4">
                <Loader2 className="w-8 h-8 text-[#8B4A6A] mx-auto mb-3 animate-spin" />
                <p className="text-gray-400 font-medium text-sm">Finding safe places near you…</p>
              </div>
            ) : filteredPois.length === 0 ? (
              <div className="text-center py-10 px-4">
                <ShieldAlert className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-400 font-medium text-sm">
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
                      ? 'border-[#8B4A6A] bg-[#8B4A6A]/5'
                      : 'border-gray-100 hover:border-[#8B4A6A] hover:bg-[#8B4A6A]/5'
                    }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className={`font-bold transition-colors ${selectedPlaceId === place.id ? 'text-[#8B4A6A]' : 'text-[#2D1B2E] group-hover:text-[#8B4A6A]'}`}>
                      {place.name}
                    </h3>
                    <span className="text-[10px] font-black text-[#8B4A6A] bg-[#8B4A6A]/10 px-2 py-0.5 rounded-full whitespace-nowrap ml-2">
                      {place.distance}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1 text-[#6B5B6B] font-medium">
                      <Shield className="w-3 h-3" /> {place.type}
                    </span>
                    <span className="text-[10px] text-gray-400">OpenStreetMap</span>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-[10px] font-bold text-gray-400 italic">{place.status}</p>
                    <div className="flex gap-2">
                      <button
                        className="p-2 bg-white rounded-lg border border-gray-100 text-gray-400 hover:text-[#8B4A6A] shadow-sm transition-colors"
                        onClick={(e) => { e.stopPropagation(); /* handle call */ }}
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                      <button
                        className="p-2 bg-[#8B4A6A] rounded-lg text-white shadow-md hover:shadow-lg transition-all"
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

        {showCommunityAlert && (
          <div className="relative flex-shrink-0 border-t border-gray-100 bg-[#2D1B2E] px-4 py-2.5 pr-11 text-white lg:px-5">
            <div className="flex items-center gap-2.5">
              <Shield className="h-4 w-4 flex-shrink-0 text-[#C94A7D]" />
              <p className="min-w-0 text-[11px] leading-snug">
                <span className="mr-1.5 font-bold uppercase tracking-wider text-[#C94A7D]">Community alert</span>
                <span className="opacity-80">OSM map data does not verify an area as safe.</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCommunityAlert(false)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Dismiss community alert"
              title="Dismiss alert"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        )}
      </aside>

      {/* Main Content: Map */}
      <main className="relative order-first h-[40dvh] min-h-[240px] max-h-[380px] w-full flex-none bg-gray-50 flex items-center justify-center lg:order-last lg:h-auto lg:max-h-none lg:min-h-0 lg:min-w-0 lg:flex-1">

        {/* Loading State or Map */}
        {isLoadingGeo ? (
          <div className="flex flex-col items-center gap-4 text-[#8B4A6A]">
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
              className="p-4 bg-white rounded-full shadow-2xl text-[#8B4A6A] hover:bg-[#8B4A6A] hover:text-white transition-all group"
              title="Go to My Location"
            >
              <Navigation className="w-6 h-6 group-hover:scale-110 transition-transform" />
            </button>
          </div>
        )}

        {/* SOS Floating Action (Mobile only) */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[1000] w-full max-w-sm px-4 lg:hidden pointer-events-none">
          <button className="w-full bg-[#DC2626] text-white py-4 rounded-2xl flex items-center justify-center gap-3 shadow-2xl animate-pulse pointer-events-auto">
            <ShieldAlert className="w-6 h-6" />
            <span className="text-sm font-bold uppercase tracking-widest">Trigger Emergency SOS</span>
          </button>
        </div>

      </main>
    </div>
  );
}
