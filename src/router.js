// Entry point for every request that is not a plain static file (see dist/_routes.json):
// the secret billing address, the two public form endpoints, and unknown paths (which fall through to 404).
import { adminPath } from "./auth.js";
import { handleBilling } from "./billing-app.js";
import { ensureDb } from "./db.js";
import { handleEnquiry } from "./enquiry.js";
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

  if (request.method === "POST" && (path === "/enquiry" || path === "/apply")) {
    return secure(await handleEnquiry(request, env, path === "/apply" ? "distributor" : "enquiry"));
  }

  const base = await adminPath(env);
  if (base && (path === base || path.startsWith(base + "/"))) {
    const res = await handleBilling(ctx, base, path.slice(base.length) || "/");
    if (res) return secure(res, true);
  }
  // everything else (including /billing and /api guesses) gets the website's normal 404 page
  return ctx.next();
}
