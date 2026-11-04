// Bundles the React app into dist/ with esbuild and copies static files + pdf.js assets.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const dist = "dist";
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(`${dist}/assets`, { recursive: true });

await build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2020", "safari15"],
  jsx: "automatic",
  outfile: `${dist}/assets/app.js`,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

const pdfRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
fs.copyFileSync(`${pdfRoot}/legacy/build/pdf.worker.min.mjs`, `${dist}/assets/pdf.worker.js`);
fs.cpSync(`${pdfRoot}/cmaps`, `${dist}/assets/cmaps`, { recursive: true });
fs.cpSync(`${pdfRoot}/standard_fonts`, `${dist}/assets/standard_fonts`, { recursive: true });

fs.copyFileSync("src/styles.css", `${dist}/assets/styles.css`);
fs.cpSync("public", dist, { recursive: true });

const appHash = createHash("sha1").update(fs.readFileSync(`${dist}/assets/app.js`)).update(fs.readFileSync(`${dist}/assets/styles.css`)).digest("hex").slice(0, 10);
let html = fs.readFileSync("src/index.html", "utf8").replaceAll("__V__", appHash);
fs.writeFileSync(`${dist}/index.html`, html);
fs.writeFileSync(`${dist}/sw.js`, fs.readFileSync("src/sw.js", "utf8").replaceAll("__V__", appHash));
fs.writeFileSync(`${dist}/_routes.json`, JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }));
console.log("built", appHash);
