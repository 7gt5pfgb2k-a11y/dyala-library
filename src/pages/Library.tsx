import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { cache, pdfStore, today } from "../store";
import type { Book, Library as Lib, Me, Stats } from "../types";
import { Cover, GoalBar, Icon, Sheet, go, useToast } from "../ui";
import { PasswordSheet } from "./Admin";

type Hit = { bookId: string; title: string; page: number; snippet: string };

export function Library({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [lib, setLib] = useState<Lib>(cache.library(me.id) ?? { books: [], shelves: [] });
  const [stats, setStats] = useState<Stats | null>(cache.stats(me.id));
  const [offline, setOffline] = useState(false);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [moving, setMoving] = useState<Book | null>(null);
  const [menu, setMenu] = useState(false);
  const [pw, setPw] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([api<Lib>("library"), api<Stats>(`stats?today=${today()}`)]);
      setLib(l); setStats(s); setOffline(false);
      cache.setLibrary(me.id, l); cache.setStats(me.id, s);
    } catch (e: any) {
      if (e.status === 0) setOffline(true);
    }
    pdfStore.keys().then((k) => setDownloaded(new Set(k)));
  }, [me.id]);
  useEffect(() => { load(); }, [load]);

  // search inside the text of all books (server side), debounced
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => api<{ results: Hit[] }>(`search?q=${encodeURIComponent(q.trim())}`).then((r) => setHits(r.results)).catch(() => setHits([])), 350);
    return () => clearTimeout(t);
  }, [q]);

  const shelves = useMemo(() => {
    const s = new Set(lib.shelves);
    lib.books.forEach((b) => b.shelf && s.add(b.shelf));
    return [...s];
  }, [lib]);

  const visible = lib.books.filter((b) => {
    const term = q.trim().toLowerCase();
    if (term && !(b.title + " " + b.author).toLowerCase().includes(term)) return false;
    if (filter === "all") return true;
    if (filter === "@reading") return b.progress.status === "reading";
    if (filter === "@done") return b.progress.status === "done";
    return b.shelf === filter;
  });

  const current = [...lib.books]
    .filter((b) => b.progress.status === "reading" && b.progress.updatedAt)
    .sort((a, b) => b.progress.updatedAt - a.progress.updatedAt)[0];

  async function moveTo(book: Book, shelf: string) {
    const name = shelf.trim();
    try {
      if (name && !shelves.includes(name)) await api("shelves", { body: { name } });
      await api(`books/${book.id}`, { method: "PUT", body: { shelf: name } });
      setMoving(null);
      load();
    } catch (e: any) { toast.show(e.message); }
  }

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>أهلاً {me.name}</h1>
          <p className="muted">{lib.books.length ? "اختاري كتابك وكملي من وين وقفتِ" : "مكتبتك فاضية، ضيفي أول كتاب"}</p>
        </div>
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="القائمة"><Icon n="more" /></button>
      </header>

      {offline && <div className="banner">لا يوجد إنترنت الآن. الكتب المحمّلة على جهازك تفتح عادي.</div>}
      {stats && <GoalBar seconds={stats.todaySeconds} goalMinutes={stats.goalMinutes} />}

      {current && !q && (
        <button className="continue" onClick={() => go(`/book/${current.id}`)}>
          <Cover book={current} className="sm" />
          <div>
            <small>تابعي القراءة</small>
            <b>{current.title}</b>
            <span className="muted">صفحة {current.progress.lastPage} من {current.pages} · {current.progress.percent}%</span>
          </div>
        </button>
      )}

      <div className="search">
        <Icon n="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحثي بالعنوان أو بنص الكتب" aria-label="بحث" />
      </div>

      {q.trim().length >= 2 && hits.length > 0 && (
        <section>
          <h2>نتائج داخل النصوص</h2>
          <ul className="hits">
            {hits.map((h, i) => (
              <li key={i}>
                <button onClick={() => go(`/book/${h.bookId}?p=${h.page}`)}>
                  <b>{h.title} · صفحة {h.page}</b>
                  <span dir="auto">{h.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="chips" role="tablist">
        {[["all", "الكل"], ["@reading", "أقرأ الآن"], ["@done", "مكتملة"], ...shelves.map((s) => [s, s])].map(([k, label]) => (
          <button key={k} className={`chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          {lib.books.length === 0 ? <>ما في كتب بعد.<br /><button className="btn" onClick={() => go("/add")}>إضافة كتاب</button></> : "ما في كتب بهالتصنيف."}
        </div>
      ) : (
        <div className="grid">
          {visible.map((b) => (
            <article key={b.id} className="card">
              <button className="card-main" onClick={() => go(`/book/${b.id}`)} disabled={!b.hasPdf}>
                <Cover book={b} />
                <b className="card-title">{b.title}</b>
                {b.author && <span className="muted small">{b.author}</span>}
              </button>
              <div className="card-foot">
                <div className="bar"><i style={{ width: `${b.progress.percent}%` }} /></div>
                <span className="small muted">{b.progress.status === "done" ? "مكتمل" : b.progress.percent ? `${b.progress.percent}%` : "لم أبدأ"}</span>
                {downloaded.has(b.id) && <span className="badge" title="محمّل على الجهاز"><Icon n="download" size={13} /></span>}
                <button className="icon-btn tiny" onClick={() => setMoving(b)} aria-label="نقل إلى رف"><Icon n="list" size={16} /></button>
              </div>
            </article>
          ))}
        </div>
      )}

      {moving && <ShelfSheet book={moving} shelves={shelves} onClose={() => setMoving(null)} onPick={(s) => moveTo(moving, s)} />}
      {menu && (
        <Sheet title="القائمة" onClose={() => setMenu(false)}>
          <button className="row" onClick={() => go("/add")}><Icon n="plus" /> إضافة كتاب</button>
          <button className="row" onClick={() => { setMenu(false); setPw(true); }}><Icon n="edit" /> تغيير كلمة السر</button>
          <button className="row" onClick={onLogout}><Icon n="logout" /> تسجيل الخروج</button>
        </Sheet>
      )}
      {pw && <PasswordSheet onClose={() => setPw(false)} done={() => { setPw(false); toast.show("تم تغيير كلمة السر"); }} />}
      {toast.node}
    </div>
  );
}

function ShelfSheet({ book, shelves, onClose, onPick }: { book: Book; shelves: string[]; onClose: () => void; onPick: (s: string) => void }) {
  const [name, setName] = useState("");
  return (
    <Sheet title={`نقل «${book.title}» إلى رف`} onClose={onClose}>
      <div className="list">
        <button className={`row ${!book.shelf ? "on" : ""}`} onClick={() => onPick("")}>بدون رف</button>
        {shelves.map((s) => <button key={s} className={`row ${book.shelf === s ? "on" : ""}`} onClick={() => onPick(s)}>{s}</button>)}
      </div>
      <form className="inline" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onPick(name); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="رف جديد" maxLength={60} />
        <button className="btn">إنشاء ونقل</button>
      </form>
    </Sheet>
  );
}
