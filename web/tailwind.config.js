/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        aat: {
          navy: "#0b1a2b",
          steel: "#1c2e42",
          accent: "#2d7dd2",
          gold: "#c9a227",
          go: "#1f9d55",
          caution: "#d9a613",
          nogo: "#c0392b",
        },
      },
    },
  },
  plugins: [],
};
