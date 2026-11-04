import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { fmtMin, today } from "../store";
import type { Book, Library, Me, Stats } from "../types";
import { Cover, Icon, Sheet, go, useToast } from "../ui";
import { AddBook } from "./AddBook";

export function Admin({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [users, setUsers] = useState<Me[]>([]);
  const [owner, setOwner] = useState<Me | null>(null);
  const [lib, setLib] = useState<Library>({ books: [], shelves: [] });
  const [stats, setStats] = useState<Stats | null>(null);
  const [edit, setEdit] = useState<Book | null>(null);
  const [pw, setPw] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api<{ users: Me[] }>("users").then((r) => {
      setUsers(r.users);
      setOwner(r.users.find((u) => u.role === "reader") ?? r.users[0]);
    });
  }, []);

  const load = useCallback(async () => {
    if (!owner) return;
    const [l, s] = await Promise.all([api<Library>(`library?owner=${owner.id}`), api<Stats>(`stats?owner=${owner.id}&today=${today()}`)]);
    setLib(l); setStats(s);
  }, [owner]);
  useEffect(() => { load().catch((e) => toast.show(e.message)); }, [load]);

  async function remove(b: Book) {
    if (!confirm(`حذف «${b.title}» نهائياً؟`)) return;
    await api(`books/${b.id}`, { method: "DELETE" });
    load();
  }
  async function setGoal(minutes: number) {
    if (!owner) return;
    await api("settings", { method: "PUT", body: { ownerId: owner.id, goalMinutes: minutes } });
    toast.show("تم حفظ الهدف اليومي");
    load();
  }

  const max = Math.max(60, ...(stats?.last7.map((d) => d.seconds) ?? [0]));

  return (
    <div className="page admin">
      <header className="top">
        <div><h1>لوحة الإدارة</h1><p className="muted">أهلاً {me.name}</p></div>
        <div className="row-inline">
          <button className="icon-btn" onClick={() => go("/")} aria-label="مكتبتي"><Icon n="list" /></button>
          <button className="icon-btn" onClick={onLogout} aria-label="تسجيل الخروج"><Icon n="logout" /></button>
        </div>
      </header>

      {users.length > 1 && (
        <label className="owner">المكتبة:
          <select value={owner?.id ?? ""} onChange={(e) => setOwner(users.find((u) => u.id === Number(e.target.value)) ?? null)}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      )}

      {stats && (
        <section className="stats">
          <h2>نشاط القراءة</h2>
          <div className="stat-grid">
            <div><b>{fmtMin(stats.totalSeconds)}</b><span>دقيقة قراءة (الكل)</span></div>
            <div><b>{fmtMin(stats.todaySeconds)}</b><span>دقيقة اليوم</span></div>
            <div><b>{stats.streak}</b><span>أيام متتالية</span></div>
            <div><b>{stats.completedBooks}</b><span>كتب مكتملة</span></div>
          </div>
          <div className="week" aria-label="آخر 7 أيام">
            {stats.last7.map((d) => (
              <div key={d.day} title={`${d.day}: ${fmtMin(d.seconds)} د`}>
                <i style={{ height: `${Math.max(4, (d.seconds / max) * 100)}%` }} />
                <small>{d.day.slice(8)}</small>
              </div>
            ))}
          </div>
          <label className="owner">الهدف اليومي (دقائق):
            <input type="number" min={1} max={600} defaultValue={stats.goalMinutes} key={stats.goalMinutes}
              onBlur={(e) => { const v = Number(e.target.value); if (v >= 1 && v !== stats.goalMinutes) setGoal(v); }} />
          </label>
        </section>
      )}

      {owner && <AddBook ownerId={owner.id} ownerName={owner.name} onDone={load} />}

      <section>
        <h2>كتب {owner?.name} ({lib.books.length})</h2>
        {lib.books.length === 0 && <p className="muted">لا يوجد كتب بعد.</p>}
        <ul className="admin-list">
          {lib.books.map((b) => (
            <li key={b.id}>
              <Cover book={b} className="xs" />
              <div className="grow">
                <b dir="auto">{b.title}</b>
                <span className="muted small">{b.pages} صفحة · {b.progress.percent}% · {b.hasPdf ? "الملف مرفوع" : "بدون ملف"}</span>
                {b.note && <span className="small note-preview" dir="auto">«{b.note}»</span>}
              </div>
              <button className="icon-btn" onClick={() => setEdit(b)} aria-label="تعديل"><Icon n="edit" size={18} /></button>
              <button className="icon-btn" onClick={() => remove(b)} aria-label="حذف"><Icon n="trash" size={18} /></button>
            </li>
          ))}
        </ul>
      </section>

      <section><button className="btn" onClick={() => setPw(true)}>تغيير كلمة السر</button></section>

      {edit && <EditSheet book={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {pw && <PasswordSheet onClose={() => setPw(false)} done={() => { setPw(false); toast.show("تم تغيير كلمة السر"); }} />}
      {toast.node}
    </div>
  );
}

function EditSheet({ book, onClose, onSaved }: { book: Book; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: book.title, author: book.author, category: book.category, note: book.note });
  const [err, setErr] = useState("");
  return (
    <Sheet title="تعديل الكتاب" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await api(`books/${book.id}`, { method: "PUT", body: f }); onSaved(); } catch (x: any) { setErr(x.message); } }}>
        <label>العنوان<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} dir="auto" required /></label>
        <label>المؤلف<input value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })} dir="auto" /></label>
        <label>التصنيف<input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} dir="auto" /></label>
        <label>رسالة شخصية قبل القراءة<textarea rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} dir="auto" /></label>
        {err && <p className="error">{err}</p>}
        <button className="btn primary">حفظ</button>
      </form>
    </Sheet>
  );
}

export function PasswordSheet({ onClose, done }: { onClose: () => void; done: () => void }) {
  const [o, setO] = useState("");
  const [n, setN] = useState("");
  const [err, setErr] = useState("");
  return (
    <Sheet title="تغيير كلمة السر" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await api("password", { body: { old: o, new: n } }); done(); } catch (x: any) { setErr(x.message); } }}>
        <label>الحالية<input type="password" value={o} onChange={(e) => setO(e.target.value)} dir="ltr" required autoComplete="current-password" /></label>
        <label>الجديدة (8 أحرف على الأقل)<input type="password" value={n} onChange={(e) => setN(e.target.value)} dir="ltr" required minLength={8} autoComplete="new-password" /></label>
        {err && <p className="error">{err}</p>}
        <button className="btn primary">تغيير</button>
      </form>
    </Sheet>
  );
}
