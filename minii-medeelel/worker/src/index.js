// Cloudflare Worker: AI хураангуйг серверт хийх сонголт (API key-г хэрэглэгчийн компьютерт хадгалахгүйн тулд,
// жишээ нь extension-ийг бусдад тараах үед). Логик нь extension/ai.js-д байгаа, энд юу ч хадгалахгүй.
import Anthropic from "@anthropic-ai/sdk";
import { summarize } from "../../extension/ai.js";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-app-token",
};
const text = (body, status) => new Response(body, { status, headers: cors });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST" || new URL(req.url).pathname !== "/summarize") return text("Not found", 404);
    // Worker-ийн URL-ийг мэдсэн хэн ч таны API key-ээр дуудаж чадахгүйн тулд
    if (!env.APP_TOKEN || req.headers.get("x-app-token") !== env.APP_TOKEN) return text("Unauthorized", 401);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const r = await summarize(Anthropic, client, await req.json());
    return r.ok ? Response.json(r.data, { headers: cors }) : text(r.message, r.status);
  },
};
