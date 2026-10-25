// Cloudflare Workers entry point (static assets + this script). Every request reaches this code first
// (run_worker_first in wrangler.jsonc); static files and public pages go straight to the asset server,
// and only the billing address and unknown paths run the app code.
import { handle } from "./router.js";

// files the asset server can answer without the app: /static/..., the catalogue PDF, robots, sitemap
const STATIC = /^\/(static\/|catalogue\.pdf$|robots\.txt$|sitemap\.xml$|favicon\.ico$)/;

export default {
  fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && STATIC.test(path)) return env.ASSETS.fetch(request);
    return handle({ request, env, waitUntil: p => ctx.waitUntil(p), next: () => env.ASSETS.fetch(request) });
  },
};
