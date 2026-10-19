/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Nunito', 'system-ui', 'sans-serif'],
        display: ['"Baloo 2"', 'system-ui', 'sans-serif'],
      },
      // Re-themed BY ROLE (SPEC_R2L_DAO_PHIEU_LUU.md "Theme mapping rule"). The old names are kept so every
      // existing class keeps working: navy-* are SURFACES (now cream/white/sand), cream* is TEXT (now ink),
      // gold/accent is the sun-yellow FILL. Hex values mirror src/styles/r2l-tokens.css.
      colors: {
        ink: '#17324D',
        accent: {
          DEFAULT: '#FFC83D',
          hover: '#E0A21A',
        },
        navy: {
          950: '#FFF8E7',
          900: '#FFFFFF',
          850: '#FFF8E7',
          800: '#FFE7A8',
        },
        cream: {
          DEFAULT: '#17324D',
          muted: '#17324D',
          dim: '#17324D',
        },
        gold: {
          DEFAULT: '#FFC83D',
          light: '#E0A21A',
        },
      },
    },
  },
  plugins: [],
};
