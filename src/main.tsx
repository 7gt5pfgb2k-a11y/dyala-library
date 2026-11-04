import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, ApiError } from "./api";
import { cache, flushQueues } from "./store";
import type { Me } from "./types";
import { go, useLocation } from "./ui";
import { Library } from "./pages/Library";
import { Reader } from "./pages/Reader";
import { Admin } from "./pages/Admin";
import { AddBookPage } from "./pages/AddBook";

function Login({ onLogin }: { onLogin: (m: Me) => void }) {
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ user: Me }>("login", { body: { username, password } });
      onLogin(r.user);
    } catch (x: any) {
      setErr(x.message);
    }
    setBusy(false);
  }
  return (
    <main className="login">
      <form onSubmit={submit} className="login-card">
        <div className="logo">★</div>
        <h1>مكتبة ديالا</h1>
        <p className="muted">كتبكِ ودراستكِ في مكان واحد</p>
        <label>اسم المستخدم
          <input value={username} onChange={(e) => setU(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" dir="ltr" required />
        </label>
        <label>كلمة السر
          <input type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" dir="ltr" required />
        </label>
        {err && <div className="error" role="alert">{err}</div>}
        <button className="btn primary" disabled={busy}>{busy ? "..." : "دخول"}</button>
      </form>
    </main>
  );
}

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const loc = useLocation();
  const path = loc.split("?")[0];

  useEffect(() => {
    api<{ user: Me }>("me")
      .then((r) => { cache.setMe(r.user); setMe(r.user); flushQueues(); })
      .catch((e: ApiError) => {
        if (e.status === 0 || e.status >= 500) setMe(cache.me()); // offline: keep working with the cached user
        else { cache.setMe(null); setMe(null); }
      });
    const online = () => flushQueues();
    addEventListener("online", online);
    return () => removeEventListener("online", online);
  }, []);

  useEffect(() => {
    if (me === null && path !== "/login") go("/login", true);
    if (me && path === "/login") go(me.role === "admin" ? "/admin" : "/", true);
  }, [me, path]);

  if (me === undefined) return <div className="splash">★</div>;
  if (!me) return <Login onLogin={(m) => { cache.setMe(m); setMe(m); go(m.role === "admin" ? "/admin" : "/", true); }} />;

  const logout = async () => {
    await api("logout", { method: "POST", body: {} }).catch(() => {});
    cache.setMe(null);
    setMe(null);
    go("/login", true);
  };

  const book = /^\/book\/([\w-]+)$/.exec(path);
  if (book) return <Reader id={book[1]} me={me} startPage={Number(new URLSearchParams(loc.split("?")[1] ?? "").get("p")) || 0} />;
  if (path === "/add") return <AddBookPage me={me} />;
  if (path === "/admin") return me.role === "admin" ? <Admin me={me} onLogout={logout} /> : <Library me={me} onLogout={logout} />;
  return <Library me={me} onLogout={logout} />;
}

createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
