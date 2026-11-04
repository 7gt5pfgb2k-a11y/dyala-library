import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { openPdf } from "../pdf";
import { cache, fmtClock, pdfStore, saveProgress, saveReading, today } from "../store";
import type { Book, Library, Me, Stats } from "../types";
import { Icon, Sheet, go, useToast } from "../ui";

type Theme = "cream" | "warm" | "dark";
const THEMES: Theme[] = ["cream", "warm", "dark"];
const THEME_LABEL: Record<Theme, string> = { cream: "كريمي", warm: "دافئ", dark: "ليلي" };
const IDLE_LIMIT = 180; // seconds without interaction before the timer stops

export function Reader({ id, me, startPage }: { id: string; me: Me; startPage: number }) {
  const [book, setBook] = useState<Book | null>(null);
  const [err, setErr] = useState("");
  const [loadPct, setLoadPct] = useState<number | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("dyala:theme") as Theme) || "cream");
  const [marks, setMarks] = useState<number[]>([]);
  const [panel, setPanel] = useState<"" | "search" | "marks">("");
  const [stats, setStats] = useState<Stats | null>(cache.stats(me.id));
  const [session, setSession] = useState(0);
  const [showNote, setShowNote] = useState(false);
  const [resize, setResize] = useState(0);
  const toast = useToast();

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<any>(null);
  const pendingRef = useRef(0);
  const lastActive = useRef(Date.now());
  const goalToasted = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const loaded = useRef(false);

  const touchActive = () => { lastActive.current = Date.now(); };

  /* ---- load book metadata + PDF (from the device if already downloaded) ---- */
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    (async () => {
      try {
        let lib: Library | null = null;
        try { lib = await api<Library>("library"); cache.setLibrary(me.id, lib); } catch { lib = cache.library(me.id); }
        const b = lib?.books.find((x) => x.id === id);
        if (!b) throw new Error("الكتاب غير موجود");
        setBook(b);
        setMarks(b.progress.bookmarks);
        const noteKey = `dyala:note:${b.id}:${b.note.length}:${b.note.slice(0, 20)}`;
        if (b.note && !localStorage.getItem(noteKey)) setShowNote(true);

        let blob = await pdfStore.get(id);
        if (!blob) {
          setLoadPct(0);
          const res = await fetch(`/api/books/${id}/pdf`, { credentials: "same-origin" }).catch(() => null);
          if (!res || !res.ok) throw new Error(res ? "تعذّر تحميل الكتاب" : "لا يوجد إنترنت، والكتاب غير محمّل على الجهاز بعد");
          const total = Number(res.headers.get("content-length")) || b.pdfSize || 1;
          const rd = res.body!.getReader();
          const chunks: Uint8Array[] = [];
          let got = 0;
          for (;;) {
            const { done, value } = await rd.read();
            if (done) break;
            chunks.push(value);
            got += value.length;
            setLoadPct(Math.min(1, got / total));
          }
          blob = new Blob(chunks as BlobPart[], { type: "application/pdf" });
          pdfStore.put(id, blob).catch(() => {});
        }
        const doc = await openPdf(await blob.arrayBuffer());
        setPdf(doc);
        setLoadPct(null);
        const start = startPage || b.progress.lastPage || 1;
        setPage(Math.min(Math.max(1, start), doc.numPages));
      } catch (e: any) {
        setErr(e.message || "تعذّر فتح الكتاب");
        setLoadPct(null);
      }
    })();
    api<Stats>(`stats?today=${today()}`).then((s) => { setStats(s); cache.setStats(me.id, s); }).catch(() => {});
  }, [id, me.id, startPage]);

  /* ---- render current page ---- */
  useEffect(() => {
    if (!pdf || !canvasRef.current || !wrapRef.current) return;
    let alive = true;
    (async () => {
      const pg = await pdf.getPage(page);
      if (!alive) return;
      const base = pg.getViewport({ scale: 1 });
      const avail = wrapRef.current!.clientWidth - 16;
      const scale = (avail / base.width) * zoom;
      let dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      let vp = pg.getViewport({ scale: scale * dpr });
      const maxPixels = 12e6; // stay under the iOS canvas limit
      if (vp.width * vp.height > maxPixels) vp = pg.getViewport({ scale: scale * dpr * Math.sqrt(maxPixels / (vp.width * vp.height)) });
      const canvas = canvasRef.current!;
      taskRef.current?.cancel();
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = `${base.width * scale}px`;
      canvas.style.height = `${base.height * scale}px`;
      const task = pg.render({ canvasContext: canvas.getContext("2d")!, viewport: vp });
      taskRef.current = task;
      try { await task.promise; } catch (e: any) { if (e?.name !== "RenderingCancelledException") console.error(e); }
    })();
    return () => { alive = false; };
  }, [pdf, page, zoom, resize]);

  useEffect(() => {
    const f = () => setResize((n) => n + 1);
    addEventListener("resize", f);
    return () => removeEventListener("resize", f);
  }, []);

  /* ---- auto-save progress ---- */
  useEffect(() => {
    if (!book || !pdf) return;
    const t = setTimeout(() => saveProgress(book.id, { lastPage: page, bookmarks: marks }), 1200);
    return () => clearTimeout(t);
  }, [page, marks, book, pdf]);

  /* ---- reading timer (only counts while visible and recently active) ---- */
  useEffect(() => {
    const tick = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastActive.current < IDLE_LIMIT * 1000) {
        setSession((s) => s + 1);
        pendingRef.current += 1;
      }
    }, 1000);
    const flush = () => { const s = pendingRef.current; if (s > 0) { pendingRef.current = 0; saveReading(s); } };
    const every = setInterval(flush, 20000);
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVis);
    addEventListener("pagehide", flush);
    return () => { clearInterval(tick); clearInterval(every); document.removeEventListener("visibilitychange", onVis); removeEventListener("pagehide", flush); flush(); };
  }, []);

  const goalSec = (stats?.goalMinutes ?? 15) * 60;
  const todaySec = (stats?.todaySeconds ?? 0) + session;
  const goalDone = todaySec >= goalSec;
  useEffect(() => {
    if (goalDone && !goalToasted.current && session > 0) { goalToasted.current = true; toast.show("أحسنتِ! حققتِ هدف القراءة اليوم ★"); }
  }, [goalDone, session]);

  const total = pdf?.numPages ?? book?.pages ?? 1;
  const goPage = useCallback((n: number) => { touchActive(); setPage(Math.min(Math.max(1, n), total)); }, [total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") goPage(page + 1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") goPage(page - 1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [page, goPage]);

  const cycleTheme = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    setTheme(next);
    localStorage.setItem("dyala:theme", next);
    toast.show(`الثيم: ${THEME_LABEL[next]}`);
  };
  const marked = marks.includes(page);
  const toggleMark = () => { touchActive(); setMarks((m) => (m.includes(page) ? m.filter((x) => x !== page) : [...m, page].sort((a, b) => a - b))); };
  const markDone = () => { if (book) { saveProgress(book.id, { lastPage: total, bookmarks: marks, status: "done" }); toast.show("تم تعليم الكتاب كمكتمل"); } };

  const onTouchStart = (e: React.TouchEvent) => { touchActive(); touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current; touch.current = null;
    if (!s || zoom > 1) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) goPage(dx < 0 ? page + 1 : page - 1);
  };

  if (err) return <div className="page center"><p className="error">{err}</p><button className="btn" onClick={() => go("/")}>رجوع للمكتبة</button></div>;

  return (
    <div className={`reader theme-${theme}`} onClick={touchActive}>
      <header className="r-top">
        <button className="icon-btn" onClick={() => go("/")} aria-label="رجوع"><Icon n="back" /></button>
        <div className="r-title" title={book?.title}>{book?.title ?? "..."}</div>
        <span className={`timer ${goalDone ? "done" : ""}`} title="وقت القراءة اليوم"><Icon n="star" size={14} fill={goalDone} /> {Math.floor(todaySec / 60)} د</span>
        <button className="icon-btn" onClick={() => setPanel("search")} aria-label="بحث في الكتاب"><Icon n="search" /></button>
        <button className={`icon-btn ${marked ? "on" : ""}`} onClick={toggleMark} aria-label="علامة" aria-pressed={marked}><Icon n="bookmark" fill={marked} /></button>
        <button className="icon-btn" onClick={cycleTheme} aria-label="تغيير الثيم"><Icon n={theme === "dark" ? "moon" : "sun"} /></button>
      </header>
      <div className="r-goal"><i style={{ width: `${Math.min(100, (todaySec / goalSec) * 100)}%` }} /></div>

      <div className="r-stage" ref={wrapRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {loadPct !== null && (
          <div className="loading">
            <p>جاري تحميل الكتاب لجهازك (مرة وحدة فقط)</p>
            <div className="bar big"><i style={{ width: `${Math.round(loadPct * 100)}%` }} /></div>
            <small>{Math.round(loadPct * 100)}%</small>
          </div>
        )}
        {!pdf && loadPct === null && <div className="loading"><p>...</p></div>}
        <canvas ref={canvasRef} className={pdf ? "" : "hidden"} />
      </div>

      <footer className="r-bottom">
        <button className="icon-btn" onClick={() => goPage(page - 1)} disabled={page <= 1} aria-label="الصفحة السابقة"><Icon n="back" /></button>
        <div className="r-page">
          <input
            type="number" min={1} max={total} value={page}
            onChange={(e) => e.target.value && goPage(Number(e.target.value))}
            aria-label="رقم الصفحة"
          />
          <span>/ {total}</span>
        </div>
        <button className="icon-btn" onClick={() => goPage(page + 1)} disabled={page >= total} aria-label="الصفحة التالية"><Icon n="chevL" /></button>
        <div className="r-tools">
          <button className="chip" onClick={() => setZoom((z) => (z >= 2.5 ? 1 : +(z + 0.5).toFixed(1)))}>تكبير {zoom === 1 ? "" : `×${zoom}`}</button>
          <button className="chip" onClick={() => setPanel("marks")}>العلامات {marks.length ? `(${marks.length})` : ""}</button>
        </div>
      </footer>

      {panel === "search" && book && <SearchPanel bookId={book.id} onClose={() => setPanel("")} onPick={(n) => { goPage(n); setPanel(""); }} />}
      {panel === "marks" && (
        <Sheet title="علاماتي" onClose={() => setPanel("")}>
          {marks.length === 0 ? <p className="muted">ما في علامات. اضغطي على أيقونة العلامة في أعلى الصفحة.</p> : (
            <div className="list">{marks.map((m) => <button key={m} className="row" onClick={() => { goPage(m); setPanel(""); }}>صفحة {m}</button>)}</div>
          )}
          <button className="row" onClick={markDone}>تعليم الكتاب كمكتمل</button>
        </Sheet>
      )}
      {showNote && book && (
        <div className="note-wrap">
          <div className="note" role="dialog" aria-label="رسالة شخصية">
            <div className="note-star"><Icon n="star" size={30} fill /></div>
            <p dir="auto">{book.note}</p>
            <button className="btn primary" onClick={() => { localStorage.setItem(`dyala:note:${book.id}:${book.note.length}:${book.note.slice(0, 20)}`, "1"); setShowNote(false); }}>ابدأ القراءة</button>
          </div>
        </div>
      )}
      {toast.node}
    </div>
  );
}

function SearchPanel({ bookId, onClose, onPick }: { bookId: string; onClose: () => void; onPick: (n: number) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ page: number; snippet: string }[] | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(() => {
      api<{ results: { page: number; snippet: string }[] }>(`books/${bookId}/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => { setRes(r.results); setMsg(""); })
        .catch((e) => setMsg(e.status === 0 ? "البحث يحتاج إنترنت" : e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [q, bookId]);
  return (
    <Sheet title="بحث في الكتاب" onClose={onClose}>
      <input autoFocus className="full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتبي كلمة أو جملة" dir="auto" />
      {msg && <p className="error">{msg}</p>}
      {res && res.length === 0 && <p className="muted">ما لقيت نتائج.</p>}
      <ul className="hits">
        {res?.map((r) => (
          <li key={r.page}><button onClick={() => onPick(r.page)}><b>صفحة {r.page}</b><span dir="auto">{r.snippet}</span></button></li>
        ))}
      </ul>
    </Sheet>
  );
}
