/** @type {import('tailwindcss').Config} */

// Surface, text and tint colors resolve to CSS variables (see src/ui/styles.css),
// so the dark theme swaps the palette in one place instead of per-class variants.
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const scale = (color, shades) => Object.fromEntries(shades.map((s) => [s, v(`${color}-${s}`)]));

export default {
  darkMode: "class",
  content: ["./src/pages/**/*.{html,tsx,ts}", "./src/ui/**/*.{tsx,ts}"],
  theme: {
    extend: {
      colors: {
        white: v("white"),
        /** Text on accent-colored buttons; stays white in both themes. */
        onaccent: "#fff",
        slate: scale("slate", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        blue: scale("blue", [50, 700]),
        red: scale("red", [50, 600, 700, 800]),
        emerald: scale("emerald", [50, 800]),
        amber: scale("amber", [700]),
      },
    },
  },
  plugins: [],
};
