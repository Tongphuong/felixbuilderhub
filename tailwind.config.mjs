/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        accent: {
          DEFAULT: '#c88f38',
          hover: '#f2cc7e',
        },
        navy: {
          950: '#10273a',
          900: '#17354a',
          850: '#1d3f58',
          800: '#244a64',
        },
        cream: {
          DEFAULT: '#f5e6c8',
          muted: '#d9c7a4',
          dim: '#aa9673',
        },
        gold: {
          DEFAULT: '#c88f38',
          light: '#f2cc7e',
        },
      },
    },
  },
  plugins: [],
};
