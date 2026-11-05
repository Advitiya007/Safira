import React from 'react';
import AppRouter from './router/Router';
import { SafetyTrackingProvider } from './context/SafetyTrackingContext';
import { ThemeProvider } from './context/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <SafetyTrackingProvider>
        <AppRouter />
      </SafetyTrackingProvider>
    </ThemeProvider>
  );
}

export default App;
