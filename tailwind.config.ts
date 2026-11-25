import type { Config } from "tailwindcss";
import daisyui from "daisyui";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        medora: {
          teal: "#0B7A7E",
          "teal-dark": "#086164",
          "teal-light": "#14B8A6",
          "teal-soft": "#E6F5F4",
          mist: "#F3F8F8",
          "mist-deep": "#E7F0F0",
          navy: "#0F2437",
          slate: "#526577",
          border: "#DCE7E7",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-plus-jakarta)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 36, 55, 0.04), 0 8px 24px rgba(15, 36, 55, 0.05)",
        float: "0 12px 32px rgba(15, 36, 55, 0.08), 0 2px 6px rgba(15, 36, 55, 0.04)",
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        medora: {
          primary: "#0B7A7E",
          "primary-content": "#FFFFFF",
          secondary: "#0F2437",
          "secondary-content": "#FFFFFF",
          accent: "#14B8A6",
          "accent-content": "#0F2437",
          neutral: "#1E293B",
          "neutral-content": "#F8FAFC",
          "base-100": "#FFFFFF",
          "base-200": "#F3F8F8",
          "base-300": "#DCE7E7",
          "base-content": "#0F2437",
          info: "#0284C7",
          success: "#15803D",
          warning: "#B45309",
          error: "#B91C1C",
        },
      },
    ],
    darkTheme: false,
    logs: false,
  },
};

export default config;
