import type { Config } from "tailwindcss";

// Design tokens for the platform. Colors are functional, not decorative:
// jade = price dropped / savings, vermilion = price rose / urgent, saffron = the
// brand accent used for "cheapest offer" highlighting. See README.md for the
// full rationale.
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#14131C",
          50: "#F5F5F7",
          100: "#E5E4EA",
          200: "#C7C5D2",
          300: "#9E9BB0",
          400: "#726E8A",
          500: "#524E6B",
          600: "#3D3A52",
          700: "#2B293D",
          800: "#1D1B29",
          900: "#14131C",
          950: "#0B0A10",
        },
        paper: {
          DEFAULT: "#FAF9F6",
          muted: "#F0EEE8",
        },
        saffron: {
          DEFAULT: "#E2A33B",
          50: "#FDF6E9",
          100: "#FAEAC8",
          200: "#F3D28C",
          300: "#EBBA57",
          400: "#E2A33B",
          500: "#C6862A",
          600: "#9C6820",
          700: "#734C18",
        },
        jade: {
          DEFAULT: "#2E9E68",
          50: "#EAF8F1",
          100: "#CDEEDD",
          200: "#A0DFC2",
          300: "#6FCBA0",
          400: "#3EB57C",
          500: "#2E9E68",
          600: "#237D52",
          700: "#1A5E3E",
          800: "#15442E",
          900: "#0F2F20",
        },
        vermilion: {
          DEFAULT: "#D64545",
          50: "#FCEBEA",
          100: "#F8CDCB",
          200: "#F0A29E",
          300: "#E87F79",
          400: "#E15F5C",
          500: "#D64545",
          600: "#B23434",
          700: "#8A2828",
          800: "#661D1D",
          900: "#471414",
        },
        slate: {
          DEFAULT: "#6B6B7A",
        },
      },
      fontFamily: {
        display: [
          "var(--font-display)",
          "Georgia",
          "Cambria",
          "serif",
        ],
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        sm: "0.375rem",
        md: "0.625rem",
        lg: "0.875rem",
        xl: "1.25rem",
        "2xl": "1.75rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(20, 19, 28, 0.04), 0 8px 24px -12px rgba(20, 19, 28, 0.16)",
        "card-hover": "0 4px 10px rgba(20, 19, 28, 0.06), 0 16px 32px -12px rgba(20, 19, 28, 0.22)",
        ring: "0 0 0 3px rgba(226, 163, 59, 0.35)",
      },
      keyframes: {
        "pop-in": {
          "0%": { transform: "scale(0.9)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "pop-in": "pop-in 0.2s ease-out",
        marquee: "marquee 32s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
