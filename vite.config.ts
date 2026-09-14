import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const hostProvidedDependencies = [
  "@tanstack/react-query",
  "@wealthfolio/addon-sdk",
  "@wealthfolio/ui",
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
  "recharts",
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: ["chrome107", "edge107", "firefox104", "safari16"],
    lib: { entry: "src/addon.tsx", fileName: () => "addon.js", formats: ["es"] },
    rollupOptions: { external: hostProvidedDependencies },
    outDir: "dist",
    minify: true,
    sourcemap: false,
  },
});
