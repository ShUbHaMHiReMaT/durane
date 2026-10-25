// Entry point for every request that is not a plain static file:
// the secret billing address, and unknown paths (which fall through to the website's 404 page).
import { adminPath } from "./auth.js";
import { handleBilling } from "./billing-app.js";
import { ensureDb } from "./db.js";
import { sameOrigin, secure } from "./http.js";

export async function handle(ctx) {
  const { request, env } = ctx;
  const path = new URL(request.url).pathname;

  if (!env.DB) {
    console.error("D1 database binding 'DB' is missing");
    return ctx.next();
  }
  await ensureDb(env);

  // forged requests from other websites are refused
  if (!sameOrigin(request)) return secure(new Response("Request blocked", { status: 403 }));

  const base = await adminPath(env);
  if (base && (path === base || path.startsWith(base + "/"))) {
    const res = await handleBilling(ctx, base, path.slice(base.length) || "/");
    if (res) return secure(res, true);
  }
  // everything else (including /billing and /api guesses) gets the website's normal 404 page
  return ctx.next();
}
