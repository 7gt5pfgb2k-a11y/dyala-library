// Local dev server: runs the same API handler as Cloudflare, with SQLite (node:sqlite) standing in for D1
// and the filesystem standing in for R2. Usage: tsx dev/dev-server.ts  (set PORT / DEV_DATA to override)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { handle } from "../server/app";
import type { Env } from "../server/types";

const PORT = Number(process.env.PORT ?? 8788);
const DATA = process.env.DEV_DATA ?? path.resolve(".dev-data");
const DIST = path.resolve("dist");
fs.mkdirSync(path.join(DATA, "r2"), { recursive: true });

const sqlite = new DatabaseSync(path.join(DATA, "d1.sqlite"));
const clean = (v: any[]) => v.map((x) => (x === undefined ? null : x));

class Stmt {
  constructor(private sql: string, private params: any[] = []) {}
  bind(...v: any[]) { return new Stmt(this.sql, clean(v)); }
  async first<T>() { return ((sqlite.prepare(this.sql).get(...this.params) as T) ?? null); }
  async all<T>() { return { results: sqlite.prepare(this.sql).all(...this.params) as T[], success: true }; }
  async run() { sqlite.prepare(this.sql).run(...this.params); return { results: [], success: true }; }
}
const DB = {
  prepare: (sql: string) => new Stmt(sql),
  async batch(stmts: Stmt[]) {
    sqlite.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      sqlite.exec("COMMIT");
      return out;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  },
};

const file = (key: string) => path.join(DATA, "r2", key.replace(/[^\w./-]/g, "_"));
const BOOKS = {
  async get(key: string) {
    const f = file(key);
    if (!fs.existsSync(f)) return null;
    const size = fs.statSync(f).size;
    return { body: Readable.toWeb(fs.createReadStream(f)) as ReadableStream, size, httpEtag: `"${size}"` };
  },
  async put(key: string, value: ArrayBuffer | string) {
    const f = file(key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof value === "string" ? value : Buffer.from(value));
  },
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) fs.rmSync(file(k), { force: true });
  },
};

const env = {
  DB, BOOKS,
  SESSION_SECRET: process.env.SESSION_SECRET ?? "dev-secret-dev-secret-dev-secret",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "admin-pass-123",
  DYALA_PASSWORD: process.env.DYALA_PASSWORD ?? "dyala-pass-123",
} as unknown as Env;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml",
  ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream", ".ttf": "font/ttf", ".wasm": "application/wasm",
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (url.pathname.startsWith("/api/")) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const hasBody = !["GET", "HEAD"].includes(req.method ?? "GET");
      const r = new Request(url, { method: req.method, headers: req.headers as any, body: hasBody ? Buffer.concat(chunks) : undefined });
      const out = await handle(r, env);
      const headers: Record<string, string | string[]> = {};
      out.headers.forEach((v, k) => { if (k !== "set-cookie") headers[k] = v; });
      const cookies = out.headers.getSetCookie?.() ?? [];
      if (cookies.length) headers["set-cookie"] = cookies;
      res.writeHead(out.status, headers);
      if (out.body) Readable.fromWeb(out.body as any).pipe(res); else res.end();
      return;
    }
    let f = path.join(DIST, decodeURIComponent(url.pathname));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
    res.writeHead(200, { "content-type": MIME[path.extname(f)] ?? "application/octet-stream", "cache-control": "no-cache" });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    console.error(e);
    res.writeHead(500).end("dev server error");
  }
}).listen(PORT, () => console.log(`dyala dev server on http://localhost:${PORT}`));
