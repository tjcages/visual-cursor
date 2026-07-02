import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualCursor } from "visual-cursor";

export default defineConfig({
  plugins: [
    ...visualCursor({ sourceDir: "src", envFlag: "INSPECT" }),
    react(),
  ],
});
