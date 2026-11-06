/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Probaline design tokens (Ink & Brass) ──────────────────────────────
        ink: { DEFAULT: '#14213D', soft: '#39445A', muted: '#5A6478', faint: '#8A94A6', tint: '#EEF1F6', 'on-dark': '#D5DCE8', 'on-dark-muted': '#B9C3D6' },
        line: { DEFAULT: '#E3E6EC', subtle: '#EDEFF3', strong: '#D5DAE2' },
        canvas: '#F6F7F9',
        // Red is reserved for "stopped"; never use it for decoration.
        stop: { DEFAULT: '#C8322A', soft: '#FBEAE8', text: '#A3231C' },
        // Brand accent: the plumb bob. Logo, focus rings and one highlight per screen; never a status.
        brass: { DEFAULT: '#B07D2B', text: '#8A5F18', 'on-dark': '#D9AE5F' },
        // Gateway outcomes. Red (stop) stays reserved for "stopped".
        allowed: { DEFAULT: '#1F7A5A', 'on-dark': '#5CC49A' },
        masked: { DEFAULT: '#2F5DA8', 'on-dark': '#8FB0F0' },
        // What an API key is for. Categories, not statuses: never reuse them for outcomes.
        cat: {
          apps: '#14213D', 'apps-soft': '#E8ECF4',
          agents: '#0E7177', 'agents-soft': '#E1F2F2',
          extension: '#6B4C9A', 'extension-soft': '#EFEAF6',
        },
      },
      fontFamily: {
        sans: ['Archivo', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
        'card-hover': '0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',
        'card-dark': '0 1px 3px rgba(0, 0, 0, 0.2), 0 1px 2px rgba(0, 0, 0, 0.1)',
        'card-dark-hover': '0 8px 24px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.2)',
      },
    },
  },
  plugins: [],
};
