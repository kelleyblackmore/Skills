import { build } from "esbuild";

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  target: "node22",
  external: ["vscode"],
  sourcemap: true,
  minify: true,
  logLevel: "info",
});
