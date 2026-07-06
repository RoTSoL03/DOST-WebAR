import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), basicSsl()],
  resolve: {
    alias: {
      "node-fetch": fileURLToPath(new URL("./src/vendor/nodeFetchBrowserStub.ts", import.meta.url))
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true
  }
});
