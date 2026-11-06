import { useContext } from 'react';
import { SafetyTrackingContext } from '../context/safetyTracking';

export const useSafetyTracking = () => {
  const context = useContext(SafetyTrackingContext);
  if (!context) throw new Error('useSafetyTracking must be used within SafetyTrackingProvider');
  return context;
};
