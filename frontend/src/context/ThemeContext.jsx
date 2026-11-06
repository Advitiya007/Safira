import { useEffect, useMemo, useState } from 'react';
import { ThemeContext } from './safiraThemeContext';
const THEMES = ['rose', 'teal', 'indigo', 'dark'];

const getSystemTheme = () => (
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'rose'
);

const getSavedTheme = () => {
  try {
    const savedTheme = window.localStorage.getItem('safira-theme');
    return THEMES.includes(savedTheme) ? savedTheme : getSystemTheme();
  } catch {
    return getSystemTheme();
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

  const value = useMemo(() => ({
    theme,
    setTheme: (nextTheme) => {
      if (THEMES.includes(nextTheme)) setTheme(nextTheme);
    },
    themes: THEMES,
  }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
