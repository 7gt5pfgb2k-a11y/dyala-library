import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon, Sheet, go, useToast } from "../ui";
import { decrypt, encrypt, hasPassphrase, saltOf, setPassphrase } from "../crypto";

type Item = { id: string; title: string; size: number; updatedAt: number };

function Unlock({ first, check, onDone }: { first: boolean; check: (p: string) => Promise<boolean>; onDone: () => void }) {
  const [p, setP] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (first && p.length < 6) return setErr("كلمة سر الكتابة لازم تكون 6 أحرف على الأقل");
    if (first && p !== p2) return setErr("الكلمتان مش متطابقتان");
    setPassphrase(p);
    if (!(await check(p))) { setPassphrase(""); return setErr("كلمة السر غلط"); }
    onDone();
  };
  return (
    <div className="page">
      <header className="top"><div><h1>{first ? "اختاري كلمة سر لكتابتك" : "افتحي مساحة الكتابة"}</h1>
        <p className="muted">{first ? "نصوصك بتتشفّر على جهازك قبل ما تنحفظ، ولا أحد غيرك بيقدر يقرأها. إذا نسيتي كلمة السر هاي ما في طريقة لاسترجاع النصوص، فاحفظيها." : "اكتبي كلمة سر الكتابة (غير كلمة سر الدخول)."}</p></div>
        <button className="icon-btn" onClick={() => go("/")} aria-label="رجوع"><Icon n="back" /></button></header>
      <form onSubmit={submit} className="login-card" style={{ boxShadow: "none" }}>
        <label>كلمة سر الكتابة<input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="off" required /></label>
        {first && <label>أعيديها<input type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="off" required /></label>}
        {err && <div className="error" role="alert">{err}</div>}
        <button className="btn primary">متابعة</button>
      </form>
    </div>
  );
}

function GateLoader({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<{ first: boolean; sample: string } | null>(null);
  useEffect(() => { api<{ writings: Item[] }>("writings").then((r) => setState({ first: r.writings.length === 0, sample: r.writings[0]?.title ?? "" })).catch(() => setState({ first: false, sample: "" })); }, []);
  if (!state) return <div className="splash">★</div>;
  return <Unlock first={state.first} check={async () => state.first || (await decrypt(state.sample)) !== null} onDone={onDone} />;
}

export function WriteList() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [unlocked, setUnlocked] = useState(hasPassphrase());
  const [err, setErr] = useState("");
  const load = async () => {
    try {
      const r = await api<{ writings: Item[] }>("writings");
      const t: Record<string, string> = {};
      for (const w of r.writings) t[w.id] = (await decrypt(w.title)) ?? "";
      setTitles(t); setItems(r.writings);
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { if (unlocked) load(); }, [unlocked]);
  const create = async () => {
    try { const r = await api<{ id: string }>("writings", { method: "POST", body: { title: await encrypt("") } }); go(`/write/${r.id}`); }
    catch (e: any) { setErr(e.message); }
  };
  if (!unlocked) {
    return <GateLoader onDone={() => setUnlocked(true)} />;
  }
  return (
    <div className="page">
      <header className="top">
        <div><h1>مساحة الكتابة</h1><p className="muted">اكتبي مذكراتك ونصوصك، وخذي ملاحظات تطوّر أسلوبك</p></div>
        <button className="icon-btn" onClick={() => go("/")} aria-label="رجوع للمكتبة"><Icon n="back" /></button>
      </header>
      {err && <p className="error">{err}</p>}
      <button className="btn primary" onClick={create}><Icon n="plus" /> نص جديد</button>
      <div className="list" style={{ marginTop: 12 }}>
        {items?.length === 0 && <p className="muted">ما في نصوص بعد. ابدئي بأول وحدة.</p>}
        {items?.map((w) => (
          <button key={w.id} className="row" onClick={() => go(`/write/${w.id}`)}>
            <span dir="auto"><b>{titles[w.id] || "بدون عنوان"}</b></span>
            <small className="muted">{new Date(w.updatedAt).toLocaleDateString("ar")}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

export function WriteEditor({ id }: { id: string }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<"" | "saving" | "saved" | "fail">("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ title: string; text: string } | null>(null);
  const [err, setErr] = useState("");
  const toast = useToast();
  const dirty = useRef(false);

  const salt = useRef<Uint8Array | undefined>(undefined);
  useEffect(() => {
    if (!hasPassphrase()) { go("/write", true); return; }
    api<{ title: string; body: string }>(`writings/${id}`).then(async (w) => {
      const t = await decrypt(w.title), b = await decrypt(w.body);
      if (t === null || b === null) { setErr("تعذّر فك التشفير"); return; }
      salt.current = saltOf(w.body);
      setTitle(t); setText(b); setLoaded(true);
    }).catch((e) => setErr(e.message));
  }, [id]);

  const save = async (t = title, b = text) => {
    setSaved("saving");
    try {
      const body = await encrypt(b, salt.current);
      salt.current = saltOf(body);
      await api(`writings/${id}`, { method: "PUT", body: { title: await encrypt(t, salt.current), body } });
      dirty.current = false; setSaved("saved");
    } catch { setSaved("fail"); }
  };
  useEffect(() => {
    if (!loaded || !dirty.current) return;
    const t = setTimeout(() => save(), 1200);
    return () => clearTimeout(t);
  }, [title, text, loaded]);
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault(); };
    addEventListener("beforeunload", f);
    return () => removeEventListener("beforeunload", f);
  }, []);

  const ask = async (mode: "feedback" | "ideas" | "memories") => {
    setBusy(true); setErr("");
    try {
      await save();
      const r = await api<{ answer: string }>("ai/write", { method: "POST", body: { title, text, mode } });
      setResult({ title: mode === "feedback" ? "ملاحظات على كتابتك" : mode === "memories" ? "أسئلة تساعدك تتذكري" : "أفكار للمتابعة", text: r.answer });
    } catch (e: any) { setErr(e.message || "تعذّر الطلب"); }
    setBusy(false);
  };
  const download = () => {
    const blob = new Blob([`${title}\n\n${text}`], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${title || "نص"}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const remove = async () => {
    if (!confirm("حذف هذا النص نهائياً؟")) return;
    await api(`writings/${id}`, { method: "DELETE" }).catch(() => {});
    go("/write");
  };
  const words = (text.trim().match(/\S+/g) ?? []).length;

  if (err && !loaded) return <div className="page center"><p className="error">{err}</p><button className="btn" onClick={() => go("/write")}>رجوع</button></div>;
  return (
    <div className="page write">
      <header className="top">
        <button className="icon-btn" onClick={() => { if (dirty.current) save(); go("/write"); }} aria-label="رجوع"><Icon n="back" /></button>
        <small className="muted">{words} كلمة · {saved === "saving" ? "جاري الحفظ..." : saved === "saved" ? "تم الحفظ" : saved === "fail" ? "فشل الحفظ" : ""}</small>
      </header>
      <input className="w-title" dir="auto" placeholder="العنوان" value={title} onChange={(e) => { dirty.current = true; setTitle(e.target.value); }} />
      <textarea className="w-body" dir="auto" placeholder="ابدئي بذكرى وحدة، مشهد أو مكان أو شخص..." value={text} onChange={(e) => { dirty.current = true; setText(e.target.value); }} />
      {err && <p className="error">{err}</p>}
      <div className="ai-bar">
        <button className="chip ai" disabled={busy || text.trim().length < 40} onClick={() => ask("feedback")}>ملاحظات AI</button>
        <button className="chip" disabled={busy || text.trim().length < 40} onClick={() => ask("memories")}>أسئلة تذكّر</button>
        <button className="chip" disabled={busy || text.trim().length < 40} onClick={() => ask("ideas")}>أفكار للمتابعة</button>
        <button className="chip" onClick={download}>تنزيل</button>
        <button className="chip" onClick={remove}>حذف</button>
      </div>
      {busy && <p className="muted">جاري التفكير...</p>}
      <small className="muted">نصوصك مشفّرة. عند طلب ملاحظات AI يُرسل النص لـ Claude لهذا الطلب فقط.</small>
      {result && (
        <Sheet title={result.title} onClose={() => setResult(null)}>
          <div dir="auto" className="ai-text">{result.text}</div>
        </Sheet>
      )}
      {toast.node}
    </div>
  );
}
