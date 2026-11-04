// Local persistence: cached library, downloaded PDFs (IndexedDB) and queued writes for when the network is down.
import { api } from "./api";
import type { Library, Me, Stats } from "./types";

const lsGet = <T,>(k: string, d: T): T => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
};
const lsSet = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ }
};

export const cache = {
  me: () => lsGet<Me | null>("dyala:me", null),
  setMe: (m: Me | null) => lsSet("dyala:me", m),
  library: (uid: number) => lsGet<Library | null>(`dyala:lib:${uid}`, null),
  setLibrary: (uid: number, l: Library) => lsSet(`dyala:lib:${uid}`, l),
  stats: (uid: number) => lsGet<Stats | null>(`dyala:stats:${uid}`, null),
  setStats: (uid: number, s: Stats) => lsSet(`dyala:stats:${uid}`, s),
};

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const fmtMin = (sec: number) => Math.floor(sec / 60);
export const fmtClock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
export const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

/* ---------- IndexedDB for downloaded PDFs ---------- */
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("dyala", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("pdf");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction("pdf", mode).objectStore("pdf"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export const pdfStore = {
  get: (id: string) => tx<Blob | undefined>("readonly", (s) => s.get(id)).catch(() => undefined),
  put: (id: string, blob: Blob) => tx("readwrite", (s) => s.put(blob, id)),
  del: (id: string) => tx("readwrite", (s) => s.delete(id)),
  keys: () => tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys()).then((k) => k.map(String)).catch(() => [] as string[]),
};

/* ---------- queued writes (offline) ---------- */
type ProgressPayload = { lastPage: number; bookmarks: number[]; status?: string };
const QP = "dyala:q:progress";
const QR = "dyala:q:reading";

export async function saveProgress(bookId: string, p: ProgressPayload) {
  try {
    await api(`books/${bookId}/progress`, { method: "PUT", body: p });
  } catch (e: any) {
    if (e.status === 0 || e.status >= 500) lsSet(QP, { ...lsGet<Record<string, ProgressPayload>>(QP, {}), [bookId]: p });
  }
}
export async function saveReading(seconds: number, day = today()) {
  if (seconds <= 0) return;
  try {
    await api("reading", { body: { day, seconds } });
  } catch (e: any) {
    if (e.status === 0 || e.status >= 500) {
      const q = lsGet<Record<string, number>>(QR, {});
      q[day] = (q[day] ?? 0) + seconds;
      lsSet(QR, q);
    }
  }
}
export async function flushQueues() {
  const qp = lsGet<Record<string, ProgressPayload>>(QP, {});
  const qr = lsGet<Record<string, number>>(QR, {});
  lsSet(QP, {});
  lsSet(QR, {});
  for (const [id, p] of Object.entries(qp)) await saveProgress(id, p);
  for (const [day, sec] of Object.entries(qr)) {
    let left = sec;
    while (left > 0) {
      const part = Math.min(left, 900);
      await saveReading(part, day);
      left -= part;
    }
  }
}
