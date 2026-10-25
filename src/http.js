// Small HTTP helpers shared by the Pages Functions.

export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; " +
  "frame-src 'self' https://www.google.com https://maps.google.com; frame-ancestors 'self'; " +
  "form-action 'self'; base-uri 'self'; object-src 'none'";

/** Adds the security headers to any response. Billing responses are also never cached or indexed. */
export function secure(resp, billing = false) {
  const r = new Response(resp.body, resp);
  const h = r.headers;
  h.set("Content-Security-Policy", CSP);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "SAMEORIGIN");
  // billing: the address is only ever sent back to this site, never to other websites
  h.set("Referrer-Policy", billing ? "same-origin" : "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (billing) {
    h.set("Cache-Control", "no-store");
    h.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return r;
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });

export const fail = (msg, status = 400) => json({ error: msg }, status);

export const html = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });

export const redirect = (location, status = 302, headers = {}) =>
  new Response(null, { status, headers: { Location: location, ...headers } });

export const clientIp = request => request.headers.get("CF-Connecting-IP") || "local";

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Today's date in India (YYYY-MM-DD); Cloudflare servers run on UTC. */
export function todayIST() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Requests that change data must come from this site's own pages (blocks cross-site request forgery). */
export function sameOrigin(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const src = request.headers.get("Origin") || request.headers.get("Referer");
  if (!src) return true;
  try {
    const from = new URL(src).host;
    // the address the visitor typed (Host header) or the one the platform reports for this request
    return from === request.headers.get("Host") || from === new URL(request.url).host;
  } catch {
    return false;
  }
}

export const escHtml = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function readJson(request) {
  try {
    const d = await request.json();
    return d && typeof d === "object" ? d : {};
  } catch {
    return {};
  }
}
