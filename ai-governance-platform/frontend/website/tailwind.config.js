/** @type {import('tailwindcss').Config} */
// Same design tokens as the dashboard (direction I): ink navy, red only for "stopped".
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#14213D', soft: '#39445A', muted: '#5A6478', faint: '#8A94A6', tint: '#EEF1F6', 'on-dark': '#D5DCE8', 'on-dark-muted': '#B9C3D6' },
        line: { DEFAULT: '#E3E6EC', subtle: '#EDEFF3', strong: '#D5DAE2' },
        canvas: '#F6F7F9',
        stop: { DEFAULT: '#C8322A', soft: '#FBEAE8', text: '#A3231C' },
      },
      fontFamily: {
        sans: ['Archivo', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
