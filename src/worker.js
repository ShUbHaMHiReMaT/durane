// Cloudflare Workers entry point (static assets + this script). Static files in dist/ are served directly;
// only requests with no matching file reach this code: the form endpoints and the secret billing address.
import { handle } from "./router.js";

export default {
  fetch(request, env, ctx) {
    return handle({ request, env, waitUntil: p => ctx.waitUntil(p), next: () => env.ASSETS.fetch(request) });
  },
};
