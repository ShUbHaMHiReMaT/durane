// Public enquiry (/enquiry) and distributor application (/apply) forms.
import { addHit, countHits, insertStmt } from "./db.js";
import { clientIp, redirect } from "./http.js";

const FIELDS = ["name", "company", "phone", "email", "city", "products", "message"];

export async function handleEnquiry(request, env, kind) {
  const back = kind === "distributor" ? "/distributor" : "/contact";
  const anchor = kind === "distributor" ? "#apply" : "#enquiry";
  const go = query => redirect(`${back}?${query}${anchor}`, 303);

  let form;
  try {
    form = await request.formData();
  } catch {
    return go("error=details");
  }
  if (form.get("website")) return go("sent=1"); // hidden field only bots fill in: pretend success
  const d = {};
  for (const f of FIELDS) d[f] = String(form.get(f) || "").trim().slice(0, 1000);
  if (!d.name || d.phone.replace(/\D/g, "").length < 10) return go("error=details");
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return go("error=email");

  const ip = clientIp(request);
  if ((await countHits(env, "form", ip, 3600)) >= 5) return go("error=limit"); // max 5 per hour per visitor
  await addHit(env, "form", ip);
  await insertStmt(env.DB, "enquiries", { kind, ...d }).run();
  return go("sent=1");
}
