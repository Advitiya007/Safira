import { useTheme } from '../../hooks/useTheme';

const THEME_OPTIONS = [
    { id: 'rose', label: 'Rose', color: 'var(--theme-swatch-rose)' },
    { id: 'teal', label: 'Teal and sage', color: 'var(--theme-swatch-teal)' },
    { id: 'indigo', label: 'Navy and indigo', color: 'var(--theme-swatch-indigo)' },
    { id: 'dark', label: 'Dark', color: 'var(--theme-swatch-dark)' },
];

export default function ThemeSwitcher() {
    const { theme, setTheme } = useTheme();

    return (
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Color theme">
            {THEME_OPTIONS.map((option) => (
                <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-label={`${option.label} theme`}
                    aria-checked={theme === option.id}
                    title={option.label}
                    onClick={() => setTheme(option.id)}
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${theme === option.id ? 'scale-105 border-primary' : 'border-line'}`}
                >
                    <span
                        aria-hidden="true"
                        className="h-7 w-7 rounded-full border border-black/10"
                        style={{ backgroundColor: `rgb(${option.color})` }}
                    />
                </button>
            ))}
        </div>
    );
}
