import type { Config } from "tailwindcss";

// Neon night market: the original palette's token NAMES are kept so no
// component had to change — cream/sand/paper = night surfaces, ink = light text, clay = pink, olive = lime, sea = cyan,
// gold = amber.
// Display = Onest behind a Segoe UI stack; body = Hanken Grotesk.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        cream: "#07060F",
        sand: "#0B0918",
        paper: "#110E20",
        ink: {
          DEFAULT: "#F4F1FF",
          soft: "#CFC9E6",
          muted: "#A39DBD",
        },
        clay: {
          DEFAULT: "#FF4FD8",
          deep: "#FF6FE0",
          light: "#FF9BE9",
        },
        olive: {
          DEFAULT: "#B6FF3D",
          light: "#D2FF8A",
        },
        sea: {
          DEFAULT: "#3DF5FF",
          deep: "#6FF8FF",
          light: "#9BFBFF",
        },
        gold: "#FFB03D",
        line: "#2A2440",
        // Money semantics mapped onto the palette so existing
        // `accent-green` (income/positive) and `accent-orange` (spent) markup
        // flips to-theme without touching every component.
        accent: {
          green: "#B6FF3D", // olive — income / positive / on-track
          "green-light": "#D2FF8A",
          purple: "#3DF5FF", // sea — secondary
          cyan: "#3DF5FF",
          red: "#FF5A5A", // clay-deep — negative
          orange: "#FFB03D", // clay — spent / discretionary
        },
      },
      fontFamily: {
        display: ['"Segoe UI Variable Display"', '"Segoe UI"', "var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 0 0 1px #2A2440, 0 18px 40px rgba(0,0,0,0.5)",
        lift: "0 0 18px rgba(255,79,216,0.25), 0 24px 50px rgba(0,0,0,0.6)",
      },
      borderRadius: {
        xl2: "20px",
      },
    },
  },
  plugins: [],
};

export default config;
