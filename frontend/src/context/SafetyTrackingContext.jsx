import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSocket, getSocket } from '../utils/socket';
import { locationAPI } from '../utils/api';
import { SafetyTrackingContext } from './safetyTracking';

const DEFAULT_LOCATION = [28.6139, 77.2090];

const waitForConnection = (socket) => new Promise((resolve, reject) => {
  if (socket.connected) return resolve();

  const timeout = setTimeout(() => {
    socket.off('connect', onConnect);
    socket.off('connect_error', onError);
    reject(new Error('Unable to connect to the live tracking service'));
  }, 10000);
  const onConnect = () => {
    clearTimeout(timeout);
    socket.off('connect_error', onError);
    resolve();
  };
  const onError = (error) => {
    clearTimeout(timeout);
    socket.off('connect', onConnect);
    reject(error);
  };

  socket.once('connect', onConnect);
  socket.once('connect_error', onError);
});

const emitWithAck = (socket, event, payload) => new Promise((resolve, reject) => {
  socket.timeout(5000).emit(event, payload, (error, response) => {
    if (error) return reject(new Error('The tracking service did not respond'));
    if (!response?.success) return reject(new Error(response?.message || 'Tracking request failed'));
    resolve(response);
  });
});

const fetchNearbyPlaces = async (latitude, longitude, radius) => {
  const response = await locationAPI.getNearbyPlaces(latitude, longitude, radius);
  const places = (response.data || []).map((place) => ({
    ...place,
    type: place.type === 'police'
      ? 'Police'
      : place.type === 'hospital'
        ? 'Hospital'
        : 'Public Place',
    distance: `${Number(place.distance).toFixed(1)} km`,
    status: 'Real Location',
  }));
  return [
    ...places.filter((place) => place.type === 'Police').slice(0, 6),
    ...places.filter((place) => place.type === 'Hospital').slice(0, 6),
    ...places.filter((place) => place.type === 'Public Place').slice(0, 6),
  ].sort((first, second) => (
    Number.parseFloat(first.distance) - Number.parseFloat(second.distance)
  ));
};

export function SafetyTrackingProvider({ children }) {
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [pois, setPois] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trackingActive, setTrackingActive] = useState(false);
  const [sharedLocations, setSharedLocations] = useState([]);
  const watchId = useRef(null);
  const trackingActiveRef = useRef(false);
  const startTrackingPromise = useRef(null);
  const initialLocationLoaded = useRef(false);

  const updateNearbyPlaces = useCallback(async (latitude, longitude, radius = 5000) => {
    try {
      setPois(await fetchNearbyPlaces(latitude, longitude, radius));
    } catch (fetchError) {
      console.error('Nearby places fetch failed:', fetchError);
      setError(`Nearby places are unavailable: ${fetchError.message}`);
    }
  }, []);

  const locate = useCallback((radius = 5000) => {
    setIsLoading(true);
    setError(null);
    if (!navigator.geolocation) {
      setError('Geolocation not supported');
      setIsLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const nextLocation = [coords.latitude, coords.longitude];
        setLocation(nextLocation);
        await updateNearbyPlaces(coords.latitude, coords.longitude, radius);
        setIsLoading(false);
      },
      (geoError) => {
        console.warn('Geolocation error:', geoError.message);
        setError('Location access denied – showing Delhi');
        updateNearbyPlaces(DEFAULT_LOCATION[0], DEFAULT_LOCATION[1], radius)
          .finally(() => setIsLoading(false));
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [updateNearbyPlaces]);

  const loadInitialLocation = useCallback((radius = 5000) => {
    if (initialLocationLoaded.current) return;
    initialLocationLoaded.current = true;
    locate(radius);
  }, [locate]);

  const stopTracking = useCallback(() => {
    if (watchId.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    trackingActiveRef.current = false;
    setTrackingActive(false);
    const socket = getSocket();
    if (socket.connected) socket.emit('tracking:stop');
  }, []);

  const startTracking = useCallback(() => {
    if (trackingActiveRef.current) return Promise.resolve();
    if (startTrackingPromise.current) return startTrackingPromise.current;

    const operation = (async () => {
      if (!navigator.geolocation) throw new Error('Geolocation is not supported by this browser');
      if (!localStorage.getItem('authToken')) throw new Error('Sign in before starting live tracking');

      const socket = connectSocket();
      if (!socket) throw new Error('Sign in before starting live tracking');
      await waitForConnection(socket);
      await emitWithAck(socket, 'tracking:start');

      trackingActiveRef.current = true;
      setTrackingActive(true);
      try {
        watchId.current = navigator.geolocation.watchPosition(
          ({ coords }) => {
            const nextLocation = [coords.latitude, coords.longitude];
            setLocation(nextLocation);
            socket.emit('tracking:location', {
              latitude: coords.latitude,
              longitude: coords.longitude,
              accuracy: coords.accuracy,
            });
          },
          (geoError) => {
            setError(`Live location unavailable: ${geoError.message}`);
            stopTracking();
          },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
        );
      } catch (trackingError) {
        trackingActiveRef.current = false;
        setTrackingActive(false);
        socket.emit('tracking:stop');
        throw trackingError;
      }
    })();

    startTrackingPromise.current = operation.finally(() => {
      startTrackingPromise.current = null;
    });
    return startTrackingPromise.current;
  }, [stopTracking]);

  const subscribeToTracking = useCallback(async (ownerId) => {
    const socket = connectSocket();
    if (!socket) throw new Error('Sign in before viewing live tracking');
    await waitForConnection(socket);
    await emitWithAck(socket, 'tracking:subscribe', { ownerId });
  }, []);

  const unsubscribeFromTracking = useCallback((ownerId) => {
    getSocket().emit('tracking:unsubscribe', { ownerId });
    setSharedLocations((current) => current.filter((item) => item.userId !== ownerId));
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const handleLocation = (nextLocation) => {
      setSharedLocations((current) => [
        ...current.filter((item) => item.userId !== nextLocation.userId),
        nextLocation,
      ]);
    };
    const handleStopped = ({ userId }) => {
      setSharedLocations((current) => current.filter((item) => item.userId !== userId));
    };
    const handleDisconnect = () => {
      if (watchId.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      trackingActiveRef.current = false;
      setTrackingActive(false);
      setSharedLocations([]);
    };

    socket.on('tracking:location', handleLocation);
    socket.on('tracking:stopped', handleStopped);
    socket.on('disconnect', handleDisconnect);
    if (localStorage.getItem('authToken')) connectSocket();

    return () => {
      socket.off('tracking:location', handleLocation);
      socket.off('tracking:stopped', handleStopped);
      socket.off('disconnect', handleDisconnect);
    };
  }, []);

  const value = {
    location,
    pois,
    isLoading,
    error,
    refresh: locate,
    loadInitialLocation,
    trackingActive,
    startTracking,
    stopTracking,
    subscribeToTracking,
    unsubscribeFromTracking,
    sharedLocations,
  };

  return (
    <SafetyTrackingContext.Provider value={value}>
      {children}
    </SafetyTrackingContext.Provider>
  );
}
