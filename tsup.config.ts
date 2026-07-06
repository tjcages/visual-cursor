import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client.tsx",
  },
  format: ["esm"],
  dts: true,
  // No shipped sourcemaps — they were >60% of the tarball, and this is a
  // dev-only tool whose readable output is small anyway.
  sourcemap: false,
  clean: true,
  target: "es2022",
  external: ["react", "react-dom", "vite", "@cursor/sdk", "typescript"],
});
