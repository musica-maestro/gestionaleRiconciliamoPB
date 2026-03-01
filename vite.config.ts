import path from "node:path";
import { fileURLToPath } from "node:url";
import { vitePlugin as remix } from "@remix-run/dev";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tailwindcss(), remix()],
  resolve: {
    alias: { "~": path.resolve(__dirname, "app") },
  },
});
