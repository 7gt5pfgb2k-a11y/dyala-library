import { useState } from "react";
import { api, uploadWithProgress } from "../api";
import { extractPdf } from "../pdf";
import { fmtSize } from "../store";
import type { Me } from "../types";
import { Icon, go } from "../ui";

type Item = {
  key: string; file: File; title: string; author: string; category: string; note: string;
  state: "idle" | "work" | "done" | "error"; msg: string; pct: number;
};

const guessTitle = (name: string) =>
  name.replace(/\.pdf$/i, "").replace(/^[0-9a-f]{8}-/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

export function AddBook({ ownerId, ownerName, onDone }: { ownerId?: number; ownerName?: string; onDone?: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);

  const patch = (key: string, p: Partial<Item>) => setItems((all) => all.map((i) => (i.key === key ? { ...i, ...p } : i)));

  function pick(files: FileList | null) {
    if (!files) return;
    const next: Item[] = [...files].filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf").map((f) => ({
      key: `${f.name}-${f.size}-${Math.random()}`, file: f, title: guessTitle(f.name), author: "", category: "", note: "", state: "idle", msg: "", pct: 0,
    }));
    setItems((cur) => [...cur, ...next]);
  }

  async function run(it: Item) {
    patch(it.key, { state: "work", msg: "قراءة الملف واستخراج النص…", pct: 0 });
    let bookId = "";
    try {
      const ex = await extractPdf(it.file, (d, t) => patch(it.key, { msg: `استخراج النص ${d}/${t}`, pct: (d / t) * 0.4 }));
      patch(it.key, { msg: "إنشاء الكتاب…", pct: 0.4 });
      const r = await api<{ id: string }>("books", { body: { title: it.title || ex.title || it.file.name, author: it.author, category: it.category, note: it.note, pages: ex.numPages, ownerId } });
      bookId = r.id;
      await uploadWithProgress(`books/${bookId}/pdf`, it.file, "application/pdf", (f) => patch(it.key, { msg: `رفع الملف ${Math.round(f * 100)}%`, pct: 0.4 + f * 0.4 }));
      for (let i = 0; i < ex.pages.length; i += 40) {
        await api(`books/${bookId}/pages`, { body: { pages: ex.pages.slice(i, i + 40) } });
        patch(it.key, { msg: "حفظ النص للبحث…", pct: 0.8 + (i / ex.pages.length) * 0.18 });
      }
      if (ex.cover) await uploadWithProgress(`books/${bookId}/cover`, ex.cover, "image/jpeg", () => {}).catch(() => {});
      patch(it.key, { state: "done", msg: `تمت الإضافة (${ex.numPages} صفحة)`, pct: 1 });
    } catch (e: any) {
      if (bookId) await api(`books/${bookId}`, { method: "DELETE" }).catch(() => {});
      patch(it.key, { state: "error", msg: e.message || "فشلت الإضافة", pct: 0 });
    }
  }

  async function start() {
    setBusy(true);
    for (const it of items.filter((i) => i.state === "idle" || i.state === "error")) await run(it);
    setBusy(false);
    onDone?.();
  }

  return (
    <section className="add">
      <h2>إضافة كتب{ownerName ? ` إلى مكتبة ${ownerName}` : ""}</h2>
      <label className="drop">
        <Icon n="plus" /> اختيار ملفات PDF
        <input type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      </label>
      {items.map((it) => (
        <div key={it.key} className={`item ${it.state}`}>
          <div className="item-head"><b dir="auto">{it.file.name}</b><span className="muted small">{fmtSize(it.file.size)}</span></div>
          {it.state === "idle" && (
            <div className="fields">
              <input placeholder="العنوان" value={it.title} onChange={(e) => patch(it.key, { title: e.target.value })} dir="auto" />
              <input placeholder="المؤلف (اختياري)" value={it.author} onChange={(e) => patch(it.key, { author: e.target.value })} dir="auto" />
              <input placeholder="المادة أو التصنيف (اختياري)" value={it.category} onChange={(e) => patch(it.key, { category: e.target.value })} dir="auto" />
              <textarea placeholder="رسالة شخصية تظهر قبل القراءة (اختياري)" value={it.note} onChange={(e) => patch(it.key, { note: e.target.value })} rows={2} dir="auto" />
              <button className="link" onClick={() => setItems((a) => a.filter((x) => x.key !== it.key))}>إزالة</button>
            </div>
          )}
          {it.state !== "idle" && (
            <>
              <div className="bar big"><i style={{ width: `${Math.round(it.pct * 100)}%` }} /></div>
              <p className={it.state === "error" ? "error" : "muted small"}>{it.msg}</p>
            </>
          )}
        </div>
      ))}
      {items.some((i) => i.state === "idle" || i.state === "error") && (
        <button className="btn primary" onClick={start} disabled={busy}>{busy ? "جاري الرفع… لا تغلق الصفحة" : "رفع الكتب"}</button>
      )}
    </section>
  );
}

export function AddBookPage({ me }: { me: Me }) {
  return (
    <div className="page">
      <header className="top">
        <button className="icon-btn" onClick={() => go(me.role === "admin" ? "/admin" : "/")} aria-label="رجوع"><Icon n="back" /></button>
        <h1>إضافة كتاب</h1>
      </header>
      <AddBook onDone={() => {}} />
    </div>
  );
}
