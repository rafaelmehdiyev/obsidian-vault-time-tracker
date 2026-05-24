import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";
const watch = process.argv[2] === "--watch";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  define: {
    // Replaced at build time so dev-only code is tree-shaken in production
    "process.env.NODE_ENV": prod ? '"production"' : '"development"',
  },
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  process.exit(0);
}
