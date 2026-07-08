import React from 'react';

export interface ColorPalette {
  id: string;
  name: string;
  primary: string;
  primaryHover: string;
  secondary: string;
  bgLight: string;
  textDark: string;
  border: string;
}

export const COLOR_PALETTES: ColorPalette[] = [
  {
    id: 'ocean',
    name: 'Azul Océano',
    primary: '#3b82f6',
    primaryHover: '#2563eb',
    secondary: '#1d4ed8',
    bgLight: '#eff6ff',
    textDark: '#1e3a8a',
    border: '#bfdbfe',
  },
  {
    id: 'emerald',
    name: 'Verde Esmeralda',
    primary: '#10b981',
    primaryHover: '#059669',
    secondary: '#047857',
    bgLight: '#f0fdf4',
    textDark: '#064e3b',
    border: '#a7f3d0',
  },
  {
    id: 'sunset',
    name: 'Naranja Atardecer',
    primary: '#f97316',
    primaryHover: '#ea580c',
    secondary: '#c2410c',
    bgLight: '#fff7ed',
    textDark: '#7c2d12',
    border: '#ffedd5',
  },
  {
    id: 'lavender',
    name: 'Lavanda Creativo',
    primary: '#8b5cf6',
    primaryHover: '#7c3aed',
    secondary: '#6d28d9',
    bgLight: '#f5f3ff',
    textDark: '#4c1d95',
    border: '#ddd6fe',
  },
  {
    id: 'charcoal',
    name: 'Gris Carbón',
    primary: '#475569',
    primaryHover: '#334155',
    secondary: '#1e293b',
    bgLight: '#f8fafc',
    textDark: '#0f172a',
    border: '#e2e8f0',
  },
  {
    id: 'hipatia',
    name: 'Hipatia Corporativo',
    primary: '#C69BFF',
    primaryHover: '#9ACEFF',
    secondary: '#08F6D9',
    bgLight: '#F6F3F0',
    textDark: '#464646',
    border: '#E3F972',
  }
];

export const CLIENT_AVATARS: string[] = [
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Jack',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Abby',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Buster',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Coco',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=George',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Luna',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Oliver',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Toby'
];

export const getPaletteStyle = (paletteId: string | undefined): React.CSSProperties => {
  const palette = COLOR_PALETTES.find(p => p.id === paletteId);
  if (!palette) return {} as React.CSSProperties;
  
  return {
    '--color-brand-primary': palette.primary,
    '--color-brand-primary-hover': palette.primaryHover,
    '--color-brand-secondary': palette.secondary,
    '--color-brand-bg-light': palette.bgLight,
    '--color-brand-text-dark': palette.textDark,
    '--color-brand-border': palette.border,
  } as React.CSSProperties;
};
