import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
 
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["back_end/venv"],
  },
  server: {
    fs: {
      deny: ["back_end/venv/**"],
    },
    port: 5173,
    proxy: {
      "/asr": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        timeout: 1_800_000,
        proxyTimeout: 1_800_000,
      },
      "/tts": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        timeout: 1_800_000,
        proxyTimeout: 1_800_000,
      },
      "/english": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        timeout: 1_800_000,
        proxyTimeout: 1_800_000,
      },
      "/hindi": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        timeout: 1_800_000,
        proxyTimeout: 1_800_000,
      },
      "/telugu": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        timeout: 1_800_000,
        proxyTimeout: 1_800_000,
      },
      "/indicconformer": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        timeout: 1_800_000,
        proxyTimeout: 1_800_000,
      },
      "/whisperturbo": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        timeout: 1_800_000,
        proxyTimeout: 1_800_000,
      },
      "/health": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        timeout: 1_800_000,
        proxyTimeout: 1_800_000,
      },
    },
  },
});
 
 