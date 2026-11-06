import type { Env } from "./types";
import { SCHEMA } from "./schema";

const enc = new TextEncoder();
const DAY = 86400000;
const MAX_PDF = 80 * 1024 * 1024;
const MAX_COVER = 600 * 1024;
const COLORS = ["#c9704a", "#5e9c94", "#8e7cc3", "#d19a3f", "#b85c7a", "#6f9a5b", "#5b86b8", "#a8745a"];

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type User = { id: number; username: string; name: string; role: "admin" | "reader" };

/* ---------- helpers ---------- */
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf: ArrayBuffer) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hashPw(pw: string, salt?: Uint8Array) {
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  // Cloudflare Workers caps PBKDF2 at 100000 iterations.
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: s as unknown as BufferSource, iterations: 100000 }, key, 256);
  return `p1$${b64(s)}$${b64(bits)}`;
}
async function checkPw(pw: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  return safeEqual(await hashPw(pw, unb64(parts[1])), stored);
}

async function hmac(data: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
async function makeToken(uid: number, secret: string) {
  const payload = `${uid}.${Date.now() + 30 * DAY}`;
  return `${payload}.${await hmac(payload, secret)}`;
}
function cookie(name: string, value: string, req: Request, maxAge: number) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown, min: number, max: number, dflt: number) => {
  const n = typeof v === "number" ? Math.trunc(v) : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const escLike = (q: string) => q.replace(/[\\%_]/g, (c) => "\\" + c);

async function body<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "طلب غير صالح");
  }
}

/* ---------- setup ---------- */
let ready: Promise<void> | null = null;
let generatedSecret: string | null = null;
const hasSecret = (env: Env) => !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 16;
async function ensureReady(env: Env) {
  if (!env.DB || !env.BOOKS) throw new HttpError(500, "ربط D1 أو R2 غير مضبوط في Cloudflare (DB / BOOKS)");
  if (!ready) {
    ready = (async () => {
      await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
      if (!hasSecret(env)) {
        // No SESSION_SECRET configured: create a random one once and keep it in D1.
        let row = await env.DB.prepare("SELECT v FROM app_secrets WHERE k='session'").first<{ v: string }>();
        if (!row) {
          const bytes = crypto.getRandomValues(new Uint8Array(32));
          const v = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
          await env.DB.prepare("INSERT OR IGNORE INTO app_secrets(k,v) VALUES('session',?)").bind(v).run();
          row = await env.DB.prepare("SELECT v FROM app_secrets WHERE k='session'").first<{ v: string }>();
        }
        generatedSecret = row!.v;
      }
      const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>();
      if (!row || row.c === 0) {
        if (!env.ADMIN_PASSWORD || !env.DYALA_PASSWORD) throw new HttpError(500, "ADMIN_PASSWORD و DYALA_PASSWORD غير مضبوطين");
        const now = Date.now();
        await env.DB.batch([
          env.DB.prepare("INSERT INTO users(username,name,role,pw,created_at) VALUES(?,?,?,?,?)").bind("ahmed", "أحمد", "admin", await hashPw(env.ADMIN_PASSWORD), now),
          env.DB.prepare("INSERT INTO users(username,name,role,pw,created_at) VALUES(?,?,?,?,?)").bind("dyala", "ديالا", "reader", await hashPw(env.DYALA_PASSWORD), now),
        ]);
      }
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  await ready;
  if (!hasSecret(env) && generatedSecret) env.SESSION_SECRET = generatedSecret;
}

async function currentUser(req: Request, env: Env): Promise<User | null> {
  const raw = /(?:^|;\s*)dyala_session=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  if (!safeEqual(sig, await hmac(`${uid}.${exp}`, env.SESSION_SECRET))) return null;
  if (Number(exp) < Date.now()) return null;
  return env.DB.prepare("SELECT id,username,name,role FROM users WHERE id=?").bind(Number(uid)).first<User>();
}


async function takeAiQuota(env: Env, user: User) {
  const day = new Date().toISOString().slice(0, 10);
  const limit = user.role === "admin" ? 30 : 200;
  const used = (await env.DB.prepare("SELECT count FROM ai_usage WHERE user_id=? AND day=?").bind(user.id, day).first<{ count: number }>())?.count ?? 0;
  if (used >= limit) throw new HttpError(429, "وصلتي للحد اليومي لأسئلة الـ AI، بنرجع بكرا");
  await env.DB.prepare("INSERT INTO ai_usage(user_id,day,count) VALUES(?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET count=count+1").bind(user.id, day).run();
  return { left: limit - used - 1, refund: () => env.DB.prepare("UPDATE ai_usage SET count=MAX(0,count-1) WHERE user_id=? AND day=?").bind(user.id, day).run() };
}
async function callClaude(env: Env, system: string, content: any[], maxTokens = 1800) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: env.AI_MODEL || "claude-sonnet-5-5", max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) { console.error("anthropic", r.status, (await r.text()).slice(0, 300)); return null; }
  const out: any = await r.json();
  return (out.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
}

/* ---------- books ---------- */
type BookRow = {
  id: string; owner_id: number; title: string; author: string; description: string; category: string; shelf: string;
  pages: number; color: string; note: string; pdf_key: string | null; pdf_size: number; has_cover: number; created_at: number;
};

async function getBook(env: Env, id: string, user: User): Promise<BookRow> {
  const b = await env.DB.prepare("SELECT * FROM books WHERE id=?").bind(id).first<BookRow>();
  if (!b || (user.role !== "admin" && b.owner_id !== user.id)) throw new HttpError(404, "الكتاب غير موجود");
  return b;
}

function snippet(t: string, q: string) {
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return t.slice(0, 140);
  const s = Math.max(0, i - 60);
  return (s > 0 ? "…" : "") + t.slice(s, i + q.length + 80) + (i + q.length + 80 < t.length ? "…" : "");
}

async function stats(env: Env, uid: number, today: string) {
  const rows = (await env.DB.prepare("SELECT day,seconds FROM reading_log WHERE user_id=? ORDER BY day DESC LIMIT 800").bind(uid).all<{ day: string; seconds: number }>()).results;
  const map = new Map(rows.map((r) => [r.day, r.seconds]));
  let streak = 0;
  let cur = today;
  if ((map.get(cur) ?? 0) <= 0) cur =new Date(Date.parse(today + "T00:00:00Z") - DAY).toISOString().slice(0, 10);
  while ((map.get(cur) ?? 0) > 0) {
    streak++;
    cur = new Date(Date.parse(cur + "T00:00:00Z") - DAY).toISOString().slice(0, 10);
  }
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.parse(today + "T00:00:00Z") - (6 - i) * DAY).toISOString().slice(0, 10);
    return { day: d, seconds: map.get(d) ?? 0 };
  });
  const done = await env.DB.prepare("SELECT COUNT(*) AS c FROM progress WHERE user_id=? AND status='done'").bind(uid).first<{ c: number }>();
  const goal = await env.DB.prepare("SELECT goal_minutes FROM settings WHERE user_id=?").bind(uid).first<{ goal_minutes: number }>();
  return {
    totalSeconds: rows.reduce((a, r) => a + r.seconds, 0),
    todaySeconds: map.get(today) ?? 0,
    streak,
    completedBooks: done?.c ?? 0,
    goalMinutes: goal?.goal_minutes ?? 15,
    last7,
  };
}

function ownerOf(url: URL, user: User) {
  const o = url.searchParams.get("owner");
  if (!o) return user.id;
  const id = int(o, 1, 1e9, user.id);
  if (id !== user.id && user.role !== "admin") throw new HttpError(403, "غير مسموح");
  return id;
}

/* ---------- router ---------- */
export async function handle(req: Request, env: Env): Promise<Response> {
  try {
    return await route(req, env);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "خطأ في الخادم" }, 500);
  }
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const m = req.method;
  const seg = path.split("/");

  if (m !== "GET" && m !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== url.host) throw new HttpError(403, "مصدر غير مسموح");
  }

  await ensureReady(env);

  /* --- public: login --- */
  if (path === "login" && m === "POST") {
    const b = await body(req);
    const username = text(b.username, 40).toLowerCase();
    const password = typeof b.password === "string" ? b.password.slice(0, 200) : "";
    const fail = await env.DB.prepare("SELECT count,ts FROM login_fail WHERE key=?").bind(username).first<{ count: number; ts: number }>();
    if (fail && fail.count >= 8 && Date.now() - fail.ts < 15 * 60000) throw new HttpError(429, "محاولات كثيرة، جرّب بعد ربع ساعة");
    const u = await env.DB.prepare("SELECT id,username,name,role,pw FROM users WHERE username=?").bind(username).first<User & { pw: string }>();
    const ok = u ? await checkPw(password, u.pw) : (await hashPw(password), false);
    if (!ok || !u) {
      await env.DB.prepare("INSERT INTO login_fail(key,count,ts) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ?-ts>900000 THEN 1 ELSE count+1 END, ts=?")
        .bind(username, Date.now(), Date.now(), Date.now()).run();
      throw new HttpError(401, "اسم المستخدم أو كلمة السر غير صحيحة");
    }
    await env.DB.prepare("DELETE FROM login_fail WHERE key=?").bind(username).run();
    const token = await makeToken(u.id, env.SESSION_SECRET);
    return json({ user: { id: u.id, username: u.username, name: u.name, role: u.role } }, 200, {
      "set-cookie": cookie("dyala_session", token, req, 30 * 86400),
    });
  }
  if (path === "logout" && m === "POST") {
    return json({ ok: true }, 200, { "set-cookie": cookie("dyala_session", "", req, 0) });
  }

  const user = await currentUser(req, env);
  if (!user) throw new HttpError(401, "سجّل الدخول أولاً");
  const isAdmin = user.role === "admin";

  if (path === "me" && m === "GET") return json({ user });

  if (path === "password" && m === "POST") {
    const b = await body(req);
    const row = await env.DB.prepare("SELECT pw FROM users WHERE id=?").bind(user.id).first<{ pw: string }>();
    if (!row || !(await checkPw(String(b.old ?? ""), row.pw))) throw new HttpError(403, "كلمة السر الحالية غير صحيحة");
    const np = String(b.new ?? "");
    if (np.length < 8) throw new HttpError(400, "كلمة السر الجديدة لازم تكون 8 أحرف على الأقل");
    await env.DB.prepare("UPDATE users SET pw=? WHERE id=?").bind(await hashPw(np), user.id).run();
    return json({ ok: true });
  }

  if (path === "users" && m === "GET") {
    if (!isAdmin) throw new HttpError(403, "غير مسموح");
    const rows = (await env.DB.prepare("SELECT id,username,name,role FROM users ORDER BY id").all()).results;
    return json({ users: rows });
  }

  /* --- library --- */
  if (path === "library" && m === "GET") {
    const owner = ownerOf(url, user);
    const rows = (await env.DB.prepare(
      `SELECT b.*, p.last_page, p.bookmarks, p.status, p.percent, p.updated_at AS p_updated
       FROM books b LEFT JOIN progress p ON p.book_id=b.id AND p.user_id=?
       WHERE b.owner_id=? ORDER BY b.created_at DESC`).bind(owner, owner).all<any>()).results;
    const shelves = (await env.DB.prepare("SELECT name FROM shelves WHERE owner_id=? ORDER BY rowid").bind(owner).all<{ name: string }>()).results.map((r) => r.name);
    const books = rows.map((r) => ({
      id: r.id, ownerId: r.owner_id, title: r.title, author: r.author, description: r.description, category: r.category,
      shelf: r.shelf, pages: r.pages, color: r.color, note: r.note, hasPdf: !!r.pdf_key, hasCover: !!r.has_cover,
      pdfSize: r.pdf_size, createdAt: r.created_at,
      progress: { lastPage: r.last_page ?? 1, bookmarks: JSON.parse(r.bookmarks ?? "[]"), status: r.status ?? "not_started", percent: r.percent ?? 0, updatedAt: r.p_updated ?? 0 },
    }));
    return json({ books, shelves });
  }

  if (path === "stats" && m === "GET") {
    const owner = ownerOf(url, user);
    const today = url.searchParams.get("today");
    return json(await stats(env, owner, isDay(today) ? today : new Date().toISOString().slice(0, 10)));
  }

  if (path === "settings" && m === "PUT") {
    const b = await body(req);
    const owner = b.ownerId && isAdmin ? int(b.ownerId, 1, 1e9, user.id) : user.id;
    await env.DB.prepare("INSERT INTO settings(user_id,goal_minutes) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET goal_minutes=excluded.goal_minutes")
      .bind(owner, int(b.goalMinutes, 1, 600, 15)).run();
    return json({ ok: true });
  }

  if (path === "reading" && m === "POST") {
    const b = await body(req);
    if (!isDay(b.day)) throw new HttpError(400, "تاريخ غير صالح");
    const seconds = int(b.seconds, 0, 900, 0);
    if (seconds > 0)
      await env.DB.prepare("INSERT INTO reading_log(user_id,day,seconds) VALUES(?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET seconds=seconds+excluded.seconds")
        .bind(user.id, b.day, seconds).run();
    return json({ ok: true });
  }

  /* --- shelves --- */
  if (path === "shelves" && m === "POST") {
    const b = await body(req);
    const owner = b.ownerId && isAdmin ? int(b.ownerId, 1, 1e9, user.id) : user.id;
    const name = text(b.name, 60);
    if (!name) throw new HttpError(400, "اسم الرف مطلوب");
    await env.DB.prepare("INSERT OR IGNORE INTO shelves(owner_id,name) VALUES(?,?)").bind(owner, name).run();
    return json({ ok: true });
  }
  if (path === "shelves" && m === "PUT") {
    const b = await body(req);
    const owner = b.ownerId && isAdmin ? int(b.ownerId, 1, 1e9, user.id) : user.id;
    const from = text(b.from, 60), to = text(b.to, 60);
    if (!from || !to) throw new HttpError(400, "اسم الرف مطلوب");
    await env.DB.batch([
      env.DB.prepare("UPDATE OR IGNORE shelves SET name=? WHERE owner_id=? AND name=?").bind(to, owner, from),
      env.DB.prepare("UPDATE books SET shelf=? WHERE owner_id=? AND shelf=?").bind(to, owner, from),
    ]);
    return json({ ok: true });
  }
  if (path === "shelves" && m === "DELETE") {
    const owner = url.searchParams.get("owner") && isAdmin ? int(url.searchParams.get("owner"), 1, 1e9, user.id) : user.id;
    const name = text(url.searchParams.get("name"), 60);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM shelves WHERE owner_id=? AND name=?").bind(owner, name),
      env.DB.prepare("UPDATE books SET shelf='' WHERE owner_id=? AND shelf=?").bind(owner, name),
    ]);
    return json({ ok: true });
  }

  /* --- search across the library --- */
  if (path === "search" && m === "GET") {
    const q = text(url.searchParams.get("q"), 80);
    if (q.length < 2) return json({ results: [] });
    const rows = (await env.DB.prepare(
      `SELECT bp.book_id AS bookId, bp.n, bp.text, b.title FROM book_pages bp JOIN books b ON b.id=bp.book_id
       WHERE b.owner_id=? AND bp.text LIKE ? ESCAPE '\\' ORDER BY b.title, bp.n LIMIT 60`).bind(user.id, `%${escLike(q)}%`).all<any>()).results;
    return json({ results: rows.map((r) => ({ bookId: r.bookId, title: r.title, page: r.n, snippet: snippet(r.text, q) })) });
  }

  /* --- writing studio --- */
  if (path === "writings" && m === "GET") {
    const rows = (await env.DB.prepare("SELECT id,title,substr(body,1,140) AS preview,length(body) AS size,updated_at AS updatedAt FROM writings WHERE user_id=? ORDER BY updated_at DESC LIMIT 200").bind(user.id).all<any>()).results;
    return json({ writings: rows });
  }
  if (path === "writings" && m === "POST") {
    const b = await body(req);
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    await env.DB.prepare("INSERT INTO writings(id,user_id,title,body,updated_at) VALUES(?,?,?,?,?)").bind(id, user.id, text(b.title, 200), "", Date.now()).run();
    return json({ id });
  }
  if (seg[0] === "writings" && seg.length === 2) {
    const w = await env.DB.prepare("SELECT id,title,body,updated_at AS updatedAt FROM writings WHERE id=? AND user_id=?").bind(seg[1], user.id).first<any>();
    if (!w) throw new HttpError(404, "غير موجود");
    if (m === "GET") return json(w);
    if (m === "PUT") {
      const b = await body(req);
      const t = typeof b.title === "string" ? b.title.trim().slice(0, 200) : w.title;
      const bd = typeof b.body === "string" ? b.body.slice(0, 80000) : w.body;
      await env.DB.prepare("UPDATE writings SET title=?,body=?,updated_at=? WHERE id=?").bind(t, bd, Date.now(), w.id).run();
      return json({ ok: true });
    }
    if (m === "DELETE") { await env.DB.prepare("DELETE FROM writings WHERE id=?").bind(w.id).run(); return json({ ok: true }); }
  }
  if (path === "ai/write" && m === "POST") {
    if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "ميزة الـ AI غير مفعّلة بعد (المفتاح غير مضاف)");
    const b = await body(req);
    const w = await env.DB.prepare("SELECT title,body FROM writings WHERE id=? AND user_id=?").bind(text(b.id, 40), user.id).first<{ title: string; body: string }>();
    if (!w) throw new HttpError(404, "غير موجود");
    if (w.body.trim().length < 40) throw new HttpError(400, "اكتبي شوي أكتر عشان أقدر أعطيك ملاحظات");
    const mode = b.mode === "ideas" ? "ideas" : b.mode === "memories" ? "memories" : "feedback";
    const q = await takeAiQuota(env, user);
    const system = [
      "You are a warm but honest writing coach for a student named Dyala who is developing her writing and is writing her memoirs (personal memories) and developing her writing. Never rewrite her whole text and never write the book for her; her voice stays hers.",
      "Detect the language of her text. Give the coaching itself in simple Arabic (light Palestinian dialect is fine); quote short snippets from her text in their original language.",
      "Be concise, specific and no flattery, no emojis. Reference exact phrases from her text. For memoir: value concrete scenes, sensory detail (what she saw, heard, smelled), dialogue, honest feelings and her own voice over summary; treat painful or private memories with care and never push her to disclose more than she wants.",
      mode === "feedback"
        ? "Task: (1) one line on what works; (2) the 3 most important problems (clarity, structure, grammar/word choice, rhythm), each with a short quote and a concrete fix; (3) rewrite at most ONE sentence as a model; (4) one short exercise for the next session."
        : mode === "memories"
        ? "Task: from what she wrote, ask 6 specific memory-jogging questions that help her recall and write the scene more vividly (people, places, sounds, smells, what was said, how she felt), then suggest a title for this memory. Do not write the text itself."
        : "Task: suggest where the piece could go next: 3 possible directions or open questions, a possible outline for the next section, and 3 questions she should answer to deepen it. Do not write the text itself.",
    ].join("\n");
    const ans = await callClaude(env, system, [{ type: "text", text: `Title: ${w.title || "(untitled)"}\n\nText:\n${w.body.slice(0, 20000)}` }], 1400);
    if (ans === null) { await q.refund(); throw new HttpError(502, "تعذّر الاتصال بالـ AI، جرّبي بعد شوي"); }
    return json({ answer: ans, left: q.left });
  }

  /* --- AI helper (explain / quiz / summary / ask) --- */
  if (path === "ai" && m === "POST") {
    if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "ميزة الـ AI غير مفعّلة بعد (المفتاح غير مضاف)");
    const b = await body(req);
    const book = await getBook(env, text(b.bookId, 40), user);
    const mode = ["explain", "quiz", "summary", "ask"].includes(b.mode) ? (b.mode as string) : "explain";
    const lang = b.lang === "en" ? "en" : "ar";
    const page = int(b.page, 1, 100000, 1);
    const from = int(b.from, 1, 100000, page);
    const to = Math.min(int(b.to, 1, 100000, page), from + 11);
    const question = text(b.question, 600);
    const history = Array.isArray(b.history) ? (b.history as any[]).slice(-6).map((h) => ({ role: h?.role === "assistant" ? "assistant" : "user", content: text(h?.content, 4000) })).filter((h) => h.content) : [];
    if (mode === "ask" && !question) throw new HttpError(400, "اكتبي السؤال");

    const day = new Date().toISOString().slice(0, 10);
    const limit = user.role === "admin" ? 30 : 200;
    const used = (await env.DB.prepare("SELECT count FROM ai_usage WHERE user_id=? AND day=?").bind(user.id, day).first<{ count: number }>())?.count ?? 0;
    if (used >= limit) throw new HttpError(429, "وصلتي للحد اليومي لأسئلة الـ AI، بنرجع بكرا");
    await env.DB.prepare("INSERT INTO ai_usage(user_id,day,count) VALUES(?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET count=count+1").bind(user.id, day).run();

    const lo = mode === "explain" || mode === "ask" ? Math.max(1, page - 1) : from;
    const hi = mode === "explain" || mode === "ask" ? Math.min(book.pages || page + 1, page + 1) : to;
    const rows = (await env.DB.prepare("SELECT n,text FROM book_pages WHERE book_id=? AND n BETWEEN ? AND ? ORDER BY n").bind(book.id, lo, hi).all<{ n: number; text: string }>()).results;
    const ctx = rows.map((r) => `[صفحة ${r.n}]\n${r.text.slice(0, 3500)}`).join("\n\n").slice(0, 24000);

    const langRule = lang === "en"
      ? "Answer in clear English."
      : "اكتب الشرح بعربية بسيطة وواضحة (لهجة بيضاء قريبة للفلسطينية مقبولة)، وخلّي المصطلحات العلمية والرموز والمعادلات بالإنجليزية كما هي في الكتاب.";
    const system = [
      `You are a patient private tutor helping a student (Dyala) study the book "${book.title}". Use only the book content provided (page text and, when attached, the page image) as your main source; if something is not in the provided pages, say so briefly and then answer from general knowledge, marking it clearly.`,
      "Always cite page numbers like (ص. 12) / (p. 12). Math formulas: write them plainly in text, step by step. Be concise; no filler, no emojis.",
      langRule,
      mode === "explain" ? `Task: explain page ${page} step by step: main idea, key terms, worked example if any, then one short check question.` : "",
      mode === "summary" ? `Task: summarise pages ${from}-${to} as a short study sheet: key concepts, formulas/definitions, common mistakes.` : "",
      mode === "quiz" ? `Task: write 5 exam-style questions from pages ${from}-${to} with increasing difficulty. Give the questions first, then an "Answers" section with short worked answers and page references.` : "",
      mode === "ask" ? "Task: answer the student's question using the pages; keep it short and direct." : "",
    ].filter(Boolean).join("\n");

    const content: any[] = [];
    if (typeof b.image === "string" && /^data:image\/jpeg;base64,/.test(b.image) && b.image.length < 3_500_000 && (mode === "explain" || mode === "ask")) {
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.image.slice(b.image.indexOf(",") + 1) } });
    }
    content.push({ type: "text", text: `Book pages (extracted text, may lose formulas):\n${ctx || "(no extracted text)"}\n\n${mode === "ask" ? `Question (current page ${page}): ${question}` : `Please do the task for the current request. Current page: ${page}.`}` });
    const messages = mode === "ask" ? [...history, { role: "user", content }] : [{ role: "user", content }];

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: env.AI_MODEL || "claude-sonnet-5-5", max_tokens: 1800, system, messages }),
    });
    if (!r.ok) {
      console.error("anthropic", r.status, (await r.text()).slice(0, 300));
      await env.DB.prepare("UPDATE ai_usage SET count=MAX(0,count-1) WHERE user_id=? AND day=?").bind(user.id, day).run();
      throw new HttpError(502, r.status === 401 ? "مفتاح الـ AI غير صحيح" : r.status === 402 || r.status === 400 ? "رصيد الـ AI غير كافٍ أو الطلب مرفوض" : "تعذّر الاتصال بالـ AI، جرّبي بعد شوي");
    }
    const out: any = await r.json();
    const answer = (out.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
    return json({ answer, left: limit - used - 1 });
  }

  /* --- books --- */
  if (path === "books" && m === "POST") {
    const b = await body(req);
    const owner = b.ownerId && isAdmin ? int(b.ownerId, 1, 1e9, user.id) : user.id;
    const title = text(b.title, 200);
    if (!title) throw new HttpError(400, "عنوان الكتاب مطلوب");
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const color = COLORS[int(parseInt(id.slice(0, 4), 16), 0, 1e9, 0) % COLORS.length];
    await env.DB.prepare(
      "INSERT INTO books(id,owner_id,title,author,description,category,shelf,pages,color,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, owner, title, text(b.author, 200), text(b.description, 2000), text(b.category, 80), text(b.shelf, 60), int(b.pages, 0, 5000, 0), color, text(b.note, 1000), Date.now()).run();
    return json({ id });
  }

  if (seg[0] === "books" && seg[1]) {
    const id = seg[1];
    const sub = seg[2];

    if (!sub && m === "PUT") {
      const book = await getBook(env, id, user);
      const b = await body(req);
      await env.DB.prepare("UPDATE books SET title=?,author=?,description=?,category=?,shelf=?,note=? WHERE id=?").bind(
        text(b.title, 200) || book.title, b.author === undefined ? book.author : text(b.author, 200),
        b.description === undefined ? book.description : text(b.description, 2000),
        b.category === undefined ? book.category : text(b.category, 80),
        b.shelf === undefined ? book.shelf : text(b.shelf, 60),
        b.note === undefined ? book.note : text(b.note, 1000), id).run();
      return json({ ok: true });
    }

    if (!sub && m === "DELETE") {
      const book = await getBook(env, id, user);
      const keys = [book.pdf_key, book.has_cover ? `cover/${id}.jpg` : null].filter(Boolean) as string[];
      if (keys.length) await env.BOOKS.delete(keys);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM book_pages WHERE book_id=?").bind(id),
        env.DB.prepare("DELETE FROM progress WHERE book_id=?").bind(id),
        env.DB.prepare("DELETE FROM books WHERE id=?").bind(id),
      ]);
      return json({ ok: true });
    }

    if (sub === "pdf" && m === "PUT") {
      const book = await getBook(env, id, user);
      const len = Number(req.headers.get("content-length") ?? 0);
      if (len > MAX_PDF) throw new HttpError(413, "الملف أكبر من 80 ميغابايت");
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_PDF) throw new HttpError(413, "الملف أكبر من 80 ميغابايت");
      if (new TextDecoder().decode(buf.slice(0, 5)) !== "%PDF-") throw new HttpError(400, "الملف ليس PDF");
      const key = `pdf/${book.id}.pdf`;
      await env.BOOKS.put(key, buf, { httpMetadata: { contentType: "application/pdf" } });
      await env.DB.prepare("UPDATE books SET pdf_key=?,pdf_size=? WHERE id=?").bind(key, buf.byteLength, id).run();
      return json({ ok: true, size: buf.byteLength });
    }

    if (sub === "pdf" && m === "GET") {
      const book = await getBook(env, id, user);
      const obj = book.pdf_key ? await env.BOOKS.get(book.pdf_key) : null;
      if (!obj) throw new HttpError(404, "ملف الكتاب غير موجود");
      return new Response(obj.body, {
        headers: { "content-type": "application/pdf", "content-length": String(obj.size), "cache-control": "private, no-store", etag: obj.httpEtag },
      });
    }

    if (sub === "cover" && m === "PUT") {
      await getBook(env, id, user);
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_COVER || buf.byteLength < 100) throw new HttpError(400, "غلاف غير صالح");
      await env.BOOKS.put(`cover/${id}.jpg`, buf, { httpMetadata: { contentType: "image/jpeg" } });
      await env.DB.prepare("UPDATE books SET has_cover=1 WHERE id=?").bind(id).run();
      return json({ ok: true });
    }

    if (sub === "cover" && m === "GET") {
      await getBook(env, id, user);
      const obj = await env.BOOKS.get(`cover/${id}.jpg`);
      if (!obj) throw new HttpError(404, "لا يوجد غلاف");
      return new Response(obj.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
    }

    if (sub === "pages" && m === "POST") {
      await getBook(env, id, user);
      const b = await body(req);
      if (!Array.isArray(b.pages) || b.pages.length > 100) throw new HttpError(400, "دفعة صفحات غير صالحة");
      const stmts = b.pages.map((p: any) =>
        env.DB.prepare("INSERT OR REPLACE INTO book_pages(book_id,n,text) VALUES(?,?,?)").bind(id, int(p?.n, 1, 5000, 1), text(p?.text, 30000)));
      if (stmts.length) await env.DB.batch(stmts);
      return json({ ok: true, count: stmts.length });
    }

    if (sub === "search" && m === "GET") {
      await getBook(env, id, user);
      const q = text(url.searchParams.get("q"), 80);
      if (q.length < 2) return json({ results: [] });
      const rows = (await env.DB.prepare("SELECT n,text FROM book_pages WHERE book_id=? AND text LIKE ? ESCAPE '\\' ORDER BY n LIMIT 60")
        .bind(id, `%${escLike(q)}%`).all<{ n: number; text: string }>()).results;
      return json({ results: rows.map((r) => ({ page: r.n, snippet: snippet(r.text, q) })) });
    }

    if (sub === "progress" && m === "PUT") {
      const book = await getBook(env, id, user);
      const b = await body(req);
      const pages = Math.max(1, book.pages);
      const lastPage = int(b.lastPage, 1, pages, 1);
      const bookmarks = Array.isArray(b.bookmarks) ? [...new Set<number>(b.bookmarks.map((x: unknown) => int(x, 1, pages, 1)))].slice(0, 300) : [];
      const percent = Math.round((lastPage / pages) * 100);
      const status = b.status === "done" || (b.status !== "reading" && lastPage >= pages) ? "done" : "reading";
      await env.DB.prepare(
        `INSERT INTO progress(user_id,book_id,last_page,bookmarks,status,percent,updated_at) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(user_id,book_id) DO UPDATE SET last_page=excluded.last_page,bookmarks=excluded.bookmarks,status=excluded.status,percent=excluded.percent,updated_at=excluded.updated_at`)
        .bind(user.id, id, lastPage, JSON.stringify(bookmarks), status, percent, Date.now()).run();
      return json({ ok: true });
    }
  }

  throw new HttpError(404, "غير موجود");
}
