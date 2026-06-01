import { useEffect, useRef } from 'react';

const THEMES = [
  { id: 'light', label: 'Light', preview: '#F3EFEA' },
  { id: 'dark', label: 'Dark', preview: '#1C1C1C' },
  { id: 'midnight', label: 'Midnight', preview: '#111827' },
  { id: 'slate', label: 'Slate', preview: '#E8EBF0' },
  { id: 'sand', label: 'Sand', preview: '#F7F3ED' },
  { id: 'forest', label: 'Forest', preview: '#111D17' },
  { id: 'rose', label: 'Rose', preview: '#FDF2F4' },
];

const ACCENTS = [
  { color: '#F54E00', label: 'Orange' },
  { color: '#1D4AFF', label: 'Blue' },
  { color: '#388600', label: 'Green' },
  { color: '#8F3FCE', label: 'Purple' },
  { color: '#0D9488', label: 'Teal' },
  { color: '#E11D48', label: 'Rose' },
  { color: '#D97706', label: 'Amber' },
  { color: '#4F46E5', label: 'Indigo' },
  { color: '#0EA5E9', label: 'Sky' },
  { color: '#DC2626', label: 'Red' },
];

interface SettingsPopoverProps {
  theme: string;
  accent: string;
  onThemeChange: (id: string) => void;
  onAccentChange: (color: string) => void;
  onClose: () => void;
}

export function SettingsPopover({ theme, accent, onThemeChange, onAccentChange, onClose }: SettingsPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div className="settings-popover" ref={ref}>
      <div className="settings-popover__header">
        <span className="settings-popover__title">Settings</span>
      </div>

      <div className="settings-popover__section">
        <span className="settings-popover__label">Theme</span>
        <div className="settings-popover__theme-grid">
          {THEMES.map(t => (
            <button
              key={t.id}
              className={`theme-swatch ${theme === t.id ? 'theme-swatch--active' : ''}`}
              onClick={() => onThemeChange(t.id)}
              title={t.label}
            >
              <span className="theme-swatch__preview" style={{ background: t.preview }}></span>
              <span className="theme-swatch__name">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-popover__section">
        <span className="settings-popover__label">Accent color</span>
        <div className="settings-popover__accent-grid">
          {ACCENTS.map(a => (
            <button
              key={a.color}
              className={`accent-swatch ${accent === a.color ? 'accent-swatch--active' : ''}`}
              onClick={() => onAccentChange(a.color)}
              title={a.label}
            >
              <span className="accent-swatch__dot" style={{ background: a.color }}></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
