/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './index.ts', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Paleta institucional SamProject (fija)
        primary: '#245B4A',
        secondary: '#DCE9DF',
        tertiary: '#D5C78E',
        background: '#F7F8F5',
        text: '#34413A',
      },
    },
  },
  plugins: [],
};
