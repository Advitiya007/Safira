import { safeRouteAPI } from './api';

export const geocodeDestination = async (query, signal) => {
  const response = await safeRouteAPI.geocode(query, signal);
  if (!response.success || !response.data) {
    throw new Error(response.message || 'No matching destination found');
  }
  return response.data;
};

export const getSafeRoutes = async (origin, destination, signal, options) => {
  const response = await safeRouteAPI.analyze({
    cityId: options.cityId,
    origin: { latitude: origin[0], longitude: origin[1] },
    destination: { latitude: destination.lat, longitude: destination.lon },
    mode: options.mode,
    departureTime: options.departureTime,
  }, signal);
  if (!response.success || !response.data?.routes?.length) {
    throw new Error(response.message || 'No route alternatives are available');
  }
  return response.data;
};
