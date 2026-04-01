/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        accent: {
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'fade-up': 'fadeUp 0.6s ease-out forwards',
        'fade-in': 'fadeIn 0.4s ease-out forwards',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan-down': 'scanDown 8s ease-in-out infinite',
        'scan-right': 'scanRight 12s ease-in-out infinite',
        'float-1': 'float1 6s ease-in-out infinite',
        'float-2': 'float2 8s ease-in-out infinite',
        'float-3': 'float3 7s ease-in-out infinite',
        'float-4': 'float1 9s ease-in-out infinite reverse',
        'float-5': 'float2 10s ease-in-out infinite',
        'shield-pulse-1': 'shieldPulse 4s ease-out infinite',
        'shield-pulse-2': 'shieldPulse 4s ease-out infinite 1s',
        'shield-pulse-3': 'shieldPulse 4s ease-out infinite 2s',
        'glow-pulse': 'glowPulse 6s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scanDown: {
          '0%, 100%': { top: '-2px', opacity: '0' },
          '10%': { opacity: '1' },
          '90%': { opacity: '1' },
          '95%': { top: '100%', opacity: '0' },
        },
        scanRight: {
          '0%, 100%': { left: '-2px', opacity: '0' },
          '10%': { opacity: '1' },
          '90%': { opacity: '1' },
          '95%': { left: '100%', opacity: '0' },
        },
        float1: {
          '0%, 100%': { transform: 'translate(0, 0)', opacity: '0.3' },
          '25%': { transform: 'translate(30px, -20px)', opacity: '0.6' },
          '50%': { transform: 'translate(-10px, -40px)', opacity: '0.4' },
          '75%': { transform: 'translate(20px, -10px)', opacity: '0.5' },
        },
        float2: {
          '0%, 100%': { transform: 'translate(0, 0)', opacity: '0.2' },
          '33%': { transform: 'translate(-25px, 15px)', opacity: '0.5' },
          '66%': { transform: 'translate(15px, -25px)', opacity: '0.3' },
        },
        float3: {
          '0%, 100%': { transform: 'translate(0, 0)', opacity: '0.25' },
          '50%': { transform: 'translate(20px, 20px)', opacity: '0.5' },
        },
        shieldPulse: {
          '0%': { transform: 'scale(0.8)', opacity: '0.6' },
          '100%': { transform: 'scale(2.5)', opacity: '0' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.15', transform: 'translate(-50%, -50%) scale(1)' },
          '50%': { opacity: '0.25', transform: 'translate(-50%, -50%) scale(1.1)' },
        },
      },
    },
  },
  plugins: [],
};
