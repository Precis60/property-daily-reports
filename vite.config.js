import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base must match the GitHub Pages project path
export default defineConfig({
  plugins: [react()],
  base: "/property-daily-reports/",
});
