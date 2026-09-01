import { defineConfig } from "vite";

// Tauri kör frontend som en vanlig webbapp i utvecklingsläge och som
// statiska filer i den byggda appen. Fast port krävs av tauri.conf.json.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
  },
});
