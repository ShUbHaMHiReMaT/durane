// Billing login: password hashing, signed session cookies and the secret billing address.
import { getSetting, setSetting } from "./db.js";

const enc = new TextEncoder();
const ITERATIONS = 100000; // highest PBKDF2 count Cloudflare Workers allow
const COOKIE = "nt_session";
const SESSION_SECONDS = 12 * 3600;

const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = bytes => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function equal(a, b) {
  if (a.length !== b.length) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const hash = await pbkdf2(password, unb64(parts[2]), Number(parts[1]));
  return equal(hash, unb64(parts[3]));
}

/** Saves a new password and signs out every existing session. */
export async function setPassword(env, password) {
  await setSetting(env, "admin_password_hash", await hashPassword(password));
  await setSetting(env, "auth_version", b64url(crypto.getRandomValues(new Uint8Array(8))));
}

async function sign(env, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(await getSetting(env, "session_secret")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function sessionCookie(env, secure) {
  const payload = b64url(enc.encode(JSON.stringify({
    v: await getSetting(env, "auth_version"), exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })));
  const value = `${payload}.${b64url(await sign(env, payload))}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}

export const clearCookie = secure => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

export async function isLoggedIn(request, env) {
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)nt_session=([^;]+)/);
  if (!m) return false;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return false;
  const expected = b64url(await sign(env, payload));
  if (!equal(enc.encode(expected), enc.encode(sig))) return false;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return data.exp > Date.now() / 1000 && data.v === (await getSetting(env, "auth_version"));
  } catch {
    return false;
  }
}

// ---- secret billing address
const PUBLIC_ROOTS = new Set(["", "about", "products", "repair-guide", "gallery", "catalogue", "catalogue.pdf", "contact",
  "distributor", "static", "robots.txt", "sitemap.xml", "api", "billing", "favicon.ico", "enquiry", "apply", "404.html"]);

export function checkAdminPath(raw) {
  const path = "/" + String(raw || "").trim().replace(/^\/+|\/+$/g, "");
  if (!/^\/[A-Za-z0-9][A-Za-z0-9_-]{5,39}$/.test(path)) return [null, "Use 6 to 40 letters, numbers, - or _ (no spaces or slashes)"];
  const low = path.toLowerCase();
  if (PUBLIC_ROOTS.has(low.slice(1)) || /^\/(api|billing|static)/.test(low)) {
    return [null, "That address is used by the website. Choose another one."];
  }
  return [path, null];
}

const cache = { path: undefined, at: 0 };

/** The secret billing address: set in Settings, or first taken from the ADMIN_PATH environment variable. */
export async function adminPath(env) {
  if (cache.path !== undefined && Date.now() - cache.at < 30000) return cache.path;
  let path = await getSetting(env, "admin_path");
  if (!path && env.ADMIN_PATH) {
    const [p] = checkAdminPath(env.ADMIN_PATH);
    if (p) { await setSetting(env, "admin_path", p); path = p; }
  }
  cache.path = path || null;
  cache.at = Date.now();
  return cache.path;
}

export async function changeAdminPath(env, raw) {
  const [path, err] = checkAdminPath(raw);
  if (err) return [null, err];
  await setSetting(env, "admin_path", path);
  cache.path = path;
  cache.at = Date.now();
  return [path, null];
}
