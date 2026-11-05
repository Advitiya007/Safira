import { useEffect, useMemo, useState } from 'react';
import { ThemeContext } from './safiraThemeContext';
const THEMES = ['green', 'blue', 'black'];
const DEFAULT_THEME = 'green';

const getSavedTheme = () => {
  try {
    const savedTheme = window.localStorage.getItem('safira-theme');
    return THEMES.includes(savedTheme) ? savedTheme : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getSavedTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('safira-theme', theme);
    } catch (error) {
      console.warn('Theme preference could not be saved:', error);
    }
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme, themes: THEMES }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
