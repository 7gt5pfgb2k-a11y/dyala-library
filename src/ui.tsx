import { useEffect, useState, type ReactNode } from "react";
import type { Book } from "./types";

/* tiny router on the History API */
export function go(to: string, replace = false) {
  history[replace ? "replaceState" : "pushState"](null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}
export function useLocation() {
  const [loc, setLoc] = useState(location.pathname + location.search);
  useEffect(() => {
    const f = () => setLoc(location.pathname + location.search);
    addEventListener("popstate", f);
    return () => removeEventListener("popstate", f);
  }, []);
  return loc;
}

const P: Record<string, string> = {
  back: "M9 6l6 6-6 6",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zm9 16l-4-4",
  bookmark: "M7 4h10v16l-5-4-5 4z",
  sun: "M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  star: "M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1L3.2 9.4l6.1-.8z",
  download: "M12 4v11m0 0l-4-4m4 4l4-4M5 20h14",
  logout: "M10 5H5v14h5M15 8l4 4-4 4M19 12H9",
  trash: "M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13",
  edit: "M4 20h4L19 9l-4-4L4 16z",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  chevL: "M15 6l-6 6 6 6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};
export function Icon({ n, size = 22, fill = false }: { n: keyof typeof P | string; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[n]} />
    </svg>
  );
}

export function Cover({ book, className = "" }: { book: Book; className?: string }) {
  const [broken, setBroken] = useState(false);
  const hasImg = book.hasCover && !broken;
  return (
    <div className={`cover ${hasImg ? "img" : ""} ${className}`} style={{ background: book.color }}>
      {hasImg ? (
        <img src={`/api/books/${book.id}/cover`} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span>{book.title}</span>
      )}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <b>{title}</b>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق"><Icon n="close" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  return { show: setMsg, node: msg ? <div className="toast" role="status">{msg}</div> : null };
}

export function GoalBar({ seconds, goalMinutes }: { seconds: number; goalMinutes: number }) {
  const pct = Math.min(100, Math.round((seconds / 60 / goalMinutes) * 100));
  const done = pct >= 100;
  return (
    <div className={`goal ${done ? "done" : ""}`} aria-label="هدف القراءة اليومي">
      <span className="goal-star"><Icon n="star" size={20} fill={done} /></span>
      <div className="goal-track"><div className="goal-fill" style={{ width: `${pct}%` }} /></div>
      <span className="goal-txt">{Math.min(goalMinutes, Math.floor(seconds / 60))}/{goalMinutes} د</span>
    </div>
  );
}
