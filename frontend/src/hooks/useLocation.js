import { useEffect } from 'react';
import { useSafetyTracking } from './useSafetyTracking';

export const useLocation = ({ radius = 5000, maxEach = 6 } = {}) => {
  const {
    refresh: refreshLocation,
    loadInitialLocation,
    ...tracking
  } = useSafetyTracking();
  const refresh = () => refreshLocation(radius);
  useEffect(() => {
    loadInitialLocation(radius);
  }, [radius, loadInitialLocation]);
  const limitedPois = [
    ...tracking.pois.filter((place) => place.type === 'Police').slice(0, maxEach),
    ...tracking.pois.filter((place) => place.type === 'Hospital').slice(0, maxEach),
    ...tracking.pois.filter((place) => place.type === 'Public Place').slice(0, maxEach),
  ];

  return { ...tracking, pois: limitedPois, refresh };
};

export default useLocation;
