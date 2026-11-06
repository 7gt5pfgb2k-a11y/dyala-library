// Client-side encryption for the writing studio: AES-GCM, key from a passphrase via PBKDF2.
// The passphrase never leaves the device; the server only stores ciphertext.
const enc = new TextEncoder();
const dec = new TextDecoder();
const PREFIX = "enc1:";
const b64 = (u: Uint8Array) => { let s = ""; for (const b of u) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let pass = "";
const keys = new Map<string, CryptoKey>();
export const setPassphrase = (p: string) => { pass = p; keys.clear(); };
export const hasPassphrase = () => !!pass;
export const isEncrypted = (s: string) => s.startsWith(PREFIX);

async function keyFor(salt: Uint8Array) {
  const id = b64(salt);
  let k = keys.get(id);
  if (!k) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    k = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    keys.set(id, k);
  }
  return k;
}
export async function encrypt(plain: string, salt?: Uint8Array): Promise<string> {
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(s), enc.encode(plain)));
  const out = new Uint8Array(16 + 12 + ct.length);
  out.set(s, 0); out.set(iv, 16); out.set(ct, 28);
  return PREFIX + b64(out);
}
// Returns null when the passphrase is wrong. Plain (legacy) text is returned as is.
export async function decrypt(s: string): Promise<string | null> {
  if (!isEncrypted(s)) return s;
  try {
    const raw = unb64(s.slice(PREFIX.length));
    const salt = raw.slice(0, 16), iv = raw.slice(16, 28), ct = raw.slice(28);
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await keyFor(salt), ct));
  } catch { return null; }
}
export const saltOf = (s: string) => (isEncrypted(s) ? unb64(s.slice(PREFIX.length)).slice(0, 16) : undefined);
