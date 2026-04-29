import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { join } from "node:path";

export default defineConfig({
  plugins: [react()],
  root: join(process.cwd(), "src/client"),
  build: {
    outDir: join(process.cwd(), "dist/client"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
});
