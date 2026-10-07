// Cloudflare Worker: (1) жагсаалтыг e-Mongolia хайлтын нэр болгох, (2) хайлтын илэрцээс зөвийг сонгох.
// Энд зөвхөн бүрдүүлэх жагсаалт ба үйлчилгээний нэрс ирнэ — иргэний хувийн мэдээлэл ирэхгүй.
const MODEL = "claude-haiku-4-5-20251001";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

async function claude(env, system, content, max_tokens = 1500) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens, system, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error(await r.text());
  const raw = (await r.json()).content?.find(c => c.type === "text")?.text || "{}";
  return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const { pathname } = new URL(req.url);
    if (req.method !== "POST") return new Response("Not found", { status: 404, headers: cors });
    const body = await req.json();

    try {
      if (pathname === "/parse") {
        const system = `Чи Монгол дахь бичиг баримт бүрдүүлэлтийн туслах. Хэрэглэгчийн бүрдүүлэх жагсаалтыг (текст эсвэл зураг) мөр мөрөөр салга.
Мөр бүрт:
- e-Mongolia (e-mongolia.mn)-оос PDF лавлагаа/тодорхойлолтоор авч болох бол "query"-д e-Mongolia дээрх албан ёсны үйлчилгээний нэрийг бич (жишээ нь «иргэний үнэмлэхний хуулбар» → «Иргэний үнэмлэхний лавлагаа»).
- Цээж зураг, анкет, өргөдөл, ажлын газрын тодорхойлолт гэх мэт e-Mongolia-оос авах боломжгүй бол query=null, note-д товч заавар.
Түгээмэл нэрсийн жишээ: ${JSON.stringify(body.hints || [])}
Зөвхөн JSON буцаа: {"items":[{"label":"анхны мөр","query":"..."|null,"note":"..."}]}`;
        const content = [];
        if (body.image) content.push({ type: "image", source: { type: "base64", media_type: body.image.media_type, data: body.image.data } });
        content.push({ type: "text", text: body.text || "Зурган дээрх жагсаалтыг уншина уу." });
        const out = await claude(env, system, content);
        return Response.json({ items: out.items || [] }, { headers: cors });
      }

      if (pathname === "/pick") {
        const system = `e-Mongolia хайлтын илэрцүүдээс хэрэглэгчийн хайсан үйлчилгээнд хамгийн тохирохыг сонго.
Тохирох нь байхгүй бол -1. Зөвхөн JSON: {"index": <тоо>}`;
        const text = `Хайсан: ${body.query}\nИлэрц:\n${(body.results || []).map((r, i) => `${i}. ${r}`).join("\n")}`;
        const out = await claude(env, system, [{ type: "text", text }], 50);
        const index = Number.isInteger(out.index) && out.index < (body.results || []).length ? out.index : -1;
        return Response.json({ index }, { headers: cors });
      }
    } catch (e) {
      return new Response(String(e.message || e), { status: 502, headers: cors });
    }
    return new Response("Not found", { status: 404, headers: cors });
  },
};
