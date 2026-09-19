/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        aat: {
          // Monotone base (Revision Directive v3.0 Section 1.1). "accent" is a
          // neutral, high-contrast tone used for links/focus rings/primary
          // affordances - not a decorative hue. The only actual colors in the
          // palette are the four fixed functional status colors and the
          // restrained destructive-action red (aat.nogo, reused for both).
          navy: "#050607",
          steel: "#111315",
          accent: "#e4e4e7",
          go: "#2f9e52",
          caution: "#c98a1a",
          nogo: "#b3362c",
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
    // Section 1.2 - zero border radius everywhere, enforced at the token
    // level so every rounded-* utility already in use compiles to 0 without
    // per-component edits.
    borderRadius: {
      none: "0px",
      sm: "0px",
      DEFAULT: "0px",
      md: "0px",
      lg: "0px",
      xl: "0px",
      "2xl": "0px",
      "3xl": "0px",
      full: "0px",
    },
  },
  plugins: [],
};
