// «Миний мэдээлэл AI»-ийн AI сервис (Cloudflare Worker).
// Extension-ийг хэрэглэгч бүр key үүсгэхгүйгээр ашиглах боломжтой болгоно: AI-г төслийн эзний НЭГ key-ээр дуудна.
//   GEMINI_API_KEY байвал Google Gemini, үгүй бол ANTHROPIC_API_KEY байвал Claude ашиглана (wrangler secret put …).
// Extension дотор нууц хадгалах боломжгүй (хэн ч задалж харна) тул нууц үгээр биш, IP тус бүрийн хязгаараар хамгаална.
// Ирсэн мэдээллийг хадгалахгүй, log бичихгүй.
//   POST /summarize  { today, sources, unavailable, changesSincePreviousMonth } → { headline, alerts, changes, ok, model }
//   POST /chat       { today, question, history, data, summary, services }      → { answer, services, intent, purpose, model }
//   POST /plan       { today, purpose, question, emongoliaServices }             → { title, items[], tips[], model }
import Anthropic from "@anthropic-ai/sdk";
import { TASKS, runGemini, runClaude } from "./ai.js";

const MAX_BODY = 200_000; // ~200KB: extension нэг удаад үүнээс бага илгээдэг

function cors(req) {
  const origin = req.headers.get("origin") || "";
  // Вэб сайтуудаас browser-оор дуудахыг хориглоно; зөвхөн Chrome extension-оос
  return origin.startsWith("chrome-extension://")
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, x-app-token", vary: "origin" }
    : {};
}

// Хүсэлтийн хэлбэрийг шалгана: алдаатай бол текст, зөв бол null
function invalid(kind, p) {
  if (!p || typeof p !== "object") return "JSON буруу байна";
  if (kind === "summary") return Array.isArray(p.sources) ? null : "sources талбар алга";
  if (kind === "plan") {
    if (typeof p.purpose !== "string" || !p.purpose.trim() || p.purpose.length > 300) return "purpose талбар буруу";
    return Array.isArray(p.emongoliaServices) && p.emongoliaServices.length <= 200 ? null : "emongoliaServices буруу";
  }
  if (typeof p.question !== "string" || !p.question.trim()) return "question талбар алга";
  if (p.question.length > 500) return "Асуулт хэт урт байна (500 тэмдэгтээс бага)";
  if (p.history && (!Array.isArray(p.history) || p.history.length > 12)) return "history хэт урт байна";
  return null;
}

export default {
  async fetch(req, env) {
    const h = cors(req);
    const text = (body, status) => new Response(body, { status, headers: h });
    if (req.method === "OPTIONS") return new Response(null, { headers: h });
    const kind = { "/summarize": "summary", "/chat": "chat", "/plan": "plan" }[new URL(req.url).pathname];
    if (req.method !== "POST" || !kind) return text("Not found", 404);

    // APP_TOKEN тохируулсан бол (зөвхөн өөртөө ашиглах үед) шаардана
    if (env.APP_TOKEN && req.headers.get("x-app-token") !== env.APP_TOKEN) return text("Unauthorized", 401);

    const ip = req.headers.get("cf-connecting-ip") || "unknown";
    if (env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({ key: ip })).success)
      return text("Хэт олон хүсэлт илгээлээ. 1 минут хүлээгээд дахин оролдоно уу.", 429);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return text("Илгээсэн мэдээлэл хэт том байна", 413);
    let payload;
    try { payload = JSON.parse(raw); } catch { return text("JSON буруу байна", 400); }
    const bad = invalid(kind, payload);
    if (bad) return text(bad, 400);

    let r;
    if (env.GEMINI_API_KEY) r = await runGemini(env.GEMINI_API_KEY, TASKS[kind], payload);
    else if (env.ANTHROPIC_API_KEY) r = await runClaude(Anthropic, new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), TASKS[kind], payload);
    else return text("Сервер дээр AI key тохируулаагүй байна", 500);

    return r.ok
      ? Response.json({ ...r.data, model: r.model || "claude" }, { headers: h })
      : text(r.message, r.status === 401 ? 500 : r.status); // эзний key буруу бол хэрэглэгчид 500 гэж харуулна
  },
};
