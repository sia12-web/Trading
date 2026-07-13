/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef6ff',
          100: '#d9eaff',
          200: '#bcd8ff',
          300: '#8ebeff',
          400: '#5a9aff',
          500: '#3b7eff',
          600: '#1a5cf5',
          700: '#1548e2',
          800: '#183bb7',
          900: '#1a3590',
        },
        surface: {
          900: '#0d0f17',
          800: '#131622',
          700: '#1a1e2e',
          600: '#222840',
          500: '#2c3352',
          400: '#3a4268',
          300: '#4e5880',
        },
        up:   '#22c55e',
        down: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 0.3s ease-out',
        'slide-up':   'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: 0 },                    '100%': { opacity: 1 } },
        slideUp: { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
