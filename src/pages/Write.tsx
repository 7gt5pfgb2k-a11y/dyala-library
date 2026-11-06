import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon, Sheet, go, useToast } from "../ui";

type Item = { id: string; title: string; preview: string; size: number; updatedAt: number };

export function WriteList() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState("");
  const load = () => api<{ writings: Item[] }>("writings").then((r) => setItems(r.writings)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const create = async () => {
    try { const r = await api<{ id: string }>("writings", { method: "POST", body: { title: "" } }); go(`/write/${r.id}`); }
    catch (e: any) { setErr(e.message); }
  };
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
            <span dir="auto"><b>{w.title || "بدون عنوان"}</b><br /><small className="muted">{w.preview.replace(/\s+/g, " ")}</small></span>
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

  useEffect(() => {
    api<{ title: string; body: string }>(`writings/${id}`).then((w) => { setTitle(w.title); setText(w.body); setLoaded(true); }).catch((e) => setErr(e.message));
  }, [id]);

  const save = async (t = title, b = text) => {
    setSaved("saving");
    try { await api(`writings/${id}`, { method: "PUT", body: { title: t, body: b } }); dirty.current = false; setSaved("saved"); }
    catch { setSaved("fail"); }
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
      const r = await api<{ answer: string }>("ai/write", { method: "POST", body: { id, mode } });
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
      {result && (
        <Sheet title={result.title} onClose={() => setResult(null)}>
          <div dir="auto" className="ai-text">{result.text}</div>
        </Sheet>
      )}
      {toast.node}
    </div>
  );
}
