import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Inika English Game",
        short_name: "Inika English",
        description: "Aprende gramática, vocabulario, idioms y phrasal verbs jugando.",
        lang: "es",
        theme_color: "#4f46e5",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/privacidad/],
      },
    }),
  ],
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
});
