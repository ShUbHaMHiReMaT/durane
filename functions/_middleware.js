// Cloudflare Pages Functions entry point. All logic lives in src/.
import { handle } from "../src/router.js";

export const onRequest = ctx => handle(ctx);
