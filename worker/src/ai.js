// AI-ийн логик: даалгаврууд (TASKS) — хураангуй (summary), асуулт-хариулт (chat), зорилгоор бичиг баримтын жагсаалт (plan),
// байгууллагаас өгсөн жагсаалтыг (текст / зураг) задлах (parse).
//  - Google Gemini: runGemini — REST generateContent, завгүй/гацсан үед өөр загвар руу шилжинэ
//  - Claude: runClaude — @anthropic-ai/sdk (ANTHROPIC_API_KEY тохируулсан үед)

export const MODEL = "claude-opus-5-5";
// Үнэгүй хувилбартай загварууд (ai.google.dev/gemini-api/docs/pricing, 2026-10-07). Тогтвортой нь эхэндээ;
// нэг нь завгүй / гацсан бол дараагийнх руу шилжинэ (2026-10-07: 3.8-flash ачааллаас болж 100+ сек гацаж байв).
export const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"];

const SUMMARY_SYSTEM = `Чи Монгол иргэнд e-Mongolia (ХУР)-аас авсан өөрийнх нь төрийн мэдээллийг ойлгомжтой тайлбарладаг туслах.
Оролт нь JSON: today (өнөөдрийн огноо), sources (эх сурвалж бүрийн ХУР-ын түүхий өгөгдөл), unavailable (татаж чадаагүй эх сурвалж),
changesSincePreviousMonth (өмнөх сарын агшинтай кодоор харьцуулсан ялгаа: added / removed / changed, эсвэл null).

Хийх зүйл:
- alerts: хэрэглэгч анхаарах, арга хэмжээ авах зүйлс. Жишээ нь төлөгдөөгүй торгууль (хэдэн хоногийн өмнө үүссэн, дүн),
  төлөгдөөгүй эрүүл мэндийн даатгалын сарууд, удахгүй дуусах бичиг баримт (үнэмлэх, паспорт, оношилгоо, албан журмын даатгал),
  хугацаа хэтэрсэн зээл, төлөгдөөгүй нэхэмжлэх. Яаралтай бол "urgent", удахгүй анхаарах бол "warning", мэдээлэл бол "info".
  action-д юу хийхийг товч бич (жишээ нь «e-Mongolia-д нэвтэрч төлбөрөө шалгана» эсвэл «харьяа байгууллагадаа хандана»).
  action-д e-Mongolia-аас өөр систем, апп, вэбсайт, банк, төлбөрийн сувгийн нэр бүү бич — өгөгдөлд байхгүй бол
  тэдгээрийг мэдэхгүй гэж үз.
- changes: өмнөх сараас юу өөрчлөгдсөнийг хүний хэлээр хураангуйл. Ялгаа null бол хоосон жагсаалт.
- ok: хэвийн байгаа зүйлс (жишээ нь «ЭМД бүх сар төлөгдсөн»).
- headline: хамгийн чухал зүйлийг нэг өгүүлбэрээр.

Дүрэм: зөвхөн өгөгдсөн өгөгдөлд тулгуурла, дүн, огноо зохиож болохгүй. Өдрийн тоог today-оос тооцоол.
Талбарын утга тодорхойгүй бол таамаглахгүй, товч дурд. Монгол хэлээр, богино, энгийн бич. Хувийн танигдах мэдээлэл бичихгүй.`;

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    alerts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          level: { type: "string", enum: ["urgent", "warning", "info"] },
          title: { type: "string" },
          detail: { type: "string" },
          action: { type: "string" },
        },
        required: ["level", "title", "detail", "action"],
        additionalProperties: false,
      },
    },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: { area: { type: "string" }, summary: { type: "string" } },
        required: ["area", "summary"],
        additionalProperties: false,
      },
    },
    ok: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "alerts", "changes", "ok"],
  additionalProperties: false,
};

const CHAT_SYSTEM = `Чи Монгол иргэнд e-Mongolia (ХУР)-аас авсан өөрийнх нь төрийн мэдээлэлд тулгуурлан асуултад хариулдаг туслах.
Оролт нь JSON: today, question (одоогийн асуулт), history (өмнөх яриа), data (татсан мэдээлэл: sources, unavailable),
summary (өмнө гаргасан хураангуй), services (асуулттай холбоотой байж болох e-Mongolia үйлчилгээнүүдийн нэрс).

- data-д байгаа мэдээллээр л хариул. Дүн, огноо, тоо зохиож болохгүй. Өдрийн тоог today-оос тооцоол.
- Асуусан мэдээлэл data-д байхгүй бол (жишээ нь цэргийн алба, боловсрол) үүнийг шууд хэл: «энэ мэдээлэл татагдаагүй».
  Дараа нь services-ээс асуултад тохирохыг (хамгийн ихдээ 3) services талбарт нэрийг нь яг адилхан бичиж санал болго.
  Тохирох нь байхгүй бол services-ийг хоосон үлдээ.
- data-д байгаа асуултад services хэрэггүй бол хоосон үлдээ.
- e-Mongolia-аас өөр систем, апп, банк, вэбсайтын нэр бүү зохио. Хувийн танигдах мэдээлэл бичихгүй.
- Монгол хэлээр, товч, ойлгомжтой хариул.
- Хэрэглэгч бичиг баримт бүрдүүлэхийг хүсвэл (жишээ нь гадаад улсын виз мэдүүлэх, сургууль, ажилд орох, зээл авах)
  intent="documents" гэж тэмдэглэ. purpose-д зорилгыг товч бич (жишээ нь «Өмнөд Солонгосын жуулчны виз»).
  answer-т «… бичиг баримтын жагсаалтыг бэлдлээ» гэх мэт нэг өгүүлбэр бич. Энэ үед services хоосон байна.
  Бусад бүх үед intent="answer", purpose="".`;

const CHAT_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    services: { type: "array", items: { type: "string" } },
    intent: { type: "string", enum: ["answer", "documents"] },
    purpose: { type: "string" },
  },
  required: ["answer", "services", "intent", "purpose"],
  additionalProperties: false,
};

// «(гадаад хэлээр)» лавлагааны маягтад «Хэл сонгох» талбар байдаг: extension үүнийг language-ээр бөглөнө
const LANGUAGE_RULES = `- language: «(гадаад хэлээр)» лавлагааны маягтын «Хэл сонгох» талбарт сонгох хэл. Хүлээн авагч улс, байгууллага
  хүлээн авдаг хэлийг сонго. Эргэлзвэл "англи" — БНСУ, Япон, Шенген, АНУ, Их Британи, Канад, Австрали зэрэг улсын
  элчин сайдын яамд англи хэлийг хүлээн авдаг. ОХУ бол "орос". «(гадаад хэлээр)» лавлагаа сонгоогүй бол "англи".
- addresseeForeign: addressee-г language хэлээр бичсэн нь (жишээ нь «Embassy of the Republic of Korea in Mongolia»).
  addressee хоосон бол "".`;

const PLAN_SYSTEM = `Чи Монгол иргэнд гадаад улсын виз мэдүүлэх болон бусад зорилгоор бичиг баримт бүрдүүлэхэд тусалдаг.
Оролт нь JSON: today, purpose (зорилго), question (хэрэглэгчийн бичсэн), emongoliaServices (e-Mongolia-оос шууд PDF-ээр авч болох лавлагаа, тодорхойлолтын нэрс).

Монгол иргэнд энэ зорилгоор ихэвчлэн шаардагддаг бичиг баримтын жагсаалтыг гарга. Мөр бүрт:
- e-Mongolia-оос лавлагаагаар авч болох бол source="emongolia", service-д emongoliaServices-ээс ЯГ тохирох нэрийг үсэг алдалгүй бич.
  Гадаад улсад өгөх тул «(гадаад хэлээр)» хувилбар байвал түүнийг сонго. Жагсаалтад тохирох нэр байхгүй бол source="self".
- Үгүй бол source="self", service="". note-д хаанаас, яаж бэлдэхийг товч бич (жишээ нь «Банкнаасаа сүүлийн 6 сарын хуулга авна»).
- label нь хүнд ойлгомжтой богино нэр. note нь хэрэгтэй бол (жишээ нь зургийн хэмжээ), үгүй бол "".
Зохиомол шаардлага нэмэхгүй. Тодорхой бус шаардлагын note-д «элчин сайдын яамнаас шалгана уу» гэж бич.
Визийн төрөл тодорхойгүй бол хамгийн түгээмэл төрлөөр гаргаад, энэ тухайгаа tips-д дурд.
e-Mongolia-ийн лавлагаа авахад маягт бөглөдөг тул:
- addressee: бичиг баримтыг хаана өгөх, «Хаана зориулж» талбарт бичих текст (жишээ нь «БНСУ-ын Элчин сайдын яаманд»).
- years: Нийгмийн даатгалын лавлагаа мэт хугацааны интервал сонгодог лавлагаанд энэ зорилгод хэдэн жилийн мэдээлэл
  шаардагддагийг бүхэл тоогоор бич (ихэвчлэн 1; тодорхойгүй бол 1). Бусад бүх мөрөнд 0.
- subject: лавлагааг хэний мэдээллээр авах — хүүхдийнх бол "child" (жишээ нь хүүхдээ сургуульд бүртгүүлэхэд хүүхдийн
  төрсний лавлагаа), бусад үед "self".
- Гэрлэлтийн байдлаас хамаарах бол «Гэрлэсний бүртгэлийн лавлагаа»-г сонго; гэрлээгүй бол extension өөрөө
  «Гэрлэсний бүртгэлгүй лавлагаа» руу шилжинэ.
${LANGUAGE_RULES}
title: жагсаалтын гарчиг. tips: богино зөвлөмжүүд (хамгийн ихдээ 4). Зардал, хугацааг тодорхой мэдэхгүй бол бүү бич.
Монгол хэлээр бич. e-Mongolia-аас өөр сайт, апп, байгууллагын холбоос бүү зохио.`;

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    addressee: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          source: { type: "string", enum: ["emongolia", "self"] },
          service: { type: "string" },
          note: { type: "string" },
          years: { type: "integer" },
          subject: { type: "string", enum: ["self", "child"] },
        },
        required: ["label", "source", "service", "note", "years", "subject"],
        additionalProperties: false,
      },
    },
    tips: { type: "array", items: { type: "string" } },
    language: { type: "string", enum: ["англи", "орос", "хятад", "япон", "солонгос", "герман", "франц"] },
    addresseeForeign: { type: "string" },
  },
  required: ["title", "addressee", "items", "tips", "language", "addresseeForeign"],
  additionalProperties: false,
};

const PARSE_SYSTEM = `Чи Монгол иргэнд бичиг баримт бүрдүүлэхэд тусалдаг. Хэрэглэгч банк, сургууль, ажил олгогч, элчин сайдын яам зэрэг
байгууллагаас өгсөн бүрдүүлэх жагсаалтаа текстээр эсвэл зургаар оруулна.
Оролт нь JSON: today, text (жагсаалт; хоосон бол хавсаргасан зурган дээрх жагсаалтыг унш),
emongoliaServices (e-Mongolia-оос шууд PDF-ээр авч болох лавлагаа, тодорхойлолтын нэрс).

Жагсаалтын мөр бүрийг нэг item болго. Жагсаалтад байхгүй мөр нэмэхгүй, байгааг хасахгүй.
Нэг мөрөнд хоёр өөр бичиг баримт бичигдсэн бол тусад нь салга. Гарчиг, тайлбар өгүүлбэрийг item болгохгүй.
- label: тухайн мөрийн бичиг баримтын нэр (дугаар, тэмдэгтгүй, товч).
- e-Mongolia-оос лавлагаагаар авч болох бол source="emongolia", service-д emongoliaServices-ээс ЯГ тохирох нэрийг үсэг алдалгүй бич
  (жишээ нь «иргэний үнэмлэхний хуулбар» → «Иргэний үнэмлэхийн лавлагаа»). Жагсаалт гадаад хэл дээр шаардсан бол
  «(гадаад хэлээр)» хувилбарыг сонго. Тохирох нэр жагсаалтад байхгүй ч e-Mongolia-д байж болох төрийн лавлагаа бол
  service-д түүний албан ёсны нэрийг бич.
- Цээж зураг, анкет, өргөдөл, ажлын газрын тодорхойлолт, банкны хуулга, эх хувь бичиг баримт гэх мэт e-Mongolia-оос
  авах боломжгүй бол source="self", service="", note-д хаанаас, яаж бэлдэхийг товч бич.
- note: жагсаалтад бичигдсэн нөхцөл (хувь тоо, хугацаа, баталгаажуулалт) байвал, үгүй бол "".
- years: Нийгмийн даатгалын лавлагаа мэт хугацааны интервал сонгодог лавлагаанд жагсаалтад заасан жилийн тоо
  (жишээ нь «сүүлийн 2 жилийн» → 2, сараар бол дээш нь бүхэл жил), заагаагүй бол 1. Бусад бүх мөрөнд 0.
- subject: хүүхдийн бичиг баримт бол "child", бусад үед "self".
title: жагсаалтын товч нэр (жишээ нь «Ипотекийн зээлийн материал»), тодорхойгүй бол «Бүрдүүлэх жагсаалт».
addressee: жагсаалтаас хаана өгөх нь тодорхой бол «Хаана зориулж» талбарт бичих текст (жишээ нь «Хаан банкинд»), үгүй бол "".
${LANGUAGE_RULES} Жагсаалтад хэл заасан бол (жишээ нь «англи хэлээр») түүнийг сонго.
tips: жагсаалтад бичигдсэн чухал ерөнхий нөхцөл (хамгийн ихдээ 3), байхгүй бол хоосон. Зохиож бүү нэм.
Монгол хэлээр бич. Хувийн танигдах мэдээлэл (нэр, регистр, утас) бичихгүй.`;

export const TASKS = {
  summary: { system: SUMMARY_SYSTEM, schema: SUMMARY_SCHEMA },
  chat: { system: CHAT_SYSTEM, schema: CHAT_SCHEMA },
  plan: { system: PLAN_SYSTEM, schema: PLAN_SCHEMA },
  parse: { system: PARSE_SYSTEM, schema: PLAN_SCHEMA }, // plan-тай ижил хэлбэр: extension нэг кодоор боловсруулна
};

// Жагсаалтын зургийг JSON-оос салгаж AI-д зураг хэлбэрээр өгнө
function splitImage(payload) {
  const { image, ...rest } = payload;
  return { image: image?.data ? image : null, text: JSON.stringify(rest) };
}

// Амжилттай бол { ok: true, data }, алдаа гарвал { ok: false, status, message } буцаана
export async function runClaude(Anthropic, client, task, payload) {
  const { image, text } = splitImage(payload);
  try {
    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Аюулгүй байдлын шүүлтүүр татгалзвал Anthropic-ийн санал болгосон загвар руу автоматаар шилжинэ
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: task.schema } },
      system: task.system,
      messages: [{
        role: "user",
        content: image ? [{ type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } }, { type: "text", text }] : text,
      }],
    });
    if (msg.stop_reason === "refusal") return { ok: false, status: 422, message: "AI хариулахаас татгалзлаа" };
    if (msg.stop_reason === "max_tokens") return { ok: false, status: 502, message: "AI-ийн хариу хэт урт болж тасарлаа" };
    return { ok: true, data: JSON.parse(msg.content.find(b => b.type === "text").text) };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, status: 401, message: "Anthropic API key буруу байна" };
    if (e instanceof Anthropic.PermissionDeniedError) return { ok: false, status: 403, message: "API key-д энэ загварыг ашиглах эрх алга" };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, status: 429, message: "Хэт олон хүсэлт — хэсэг хүлээгээд дахин оролдоно уу" };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, status: 400, message: "Хүсэлт буруу: " + e.message };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, status: 503, message: "Anthropic руу холбогдож чадсангүй" };
    if (e instanceof Anthropic.APIError) return { ok: false, status: 502, message: `Anthropic API алдаа ${e.status}: ${e.message}` };
    return { ok: false, status: 500, message: "Алдаа: " + (e.message || e) };
  }
}

// Google Gemini API. Үр дүн нь runClaude()-тэй ижил хэлбэртэй.
// Загвар завгүй (503) эсвэл хязгаарт хүрсэн (429) бол түр хүлээгээд, дараа нь өөр загвар руу шилжинэ.
export async function runGemini(apiKey, task, payload, onProgress = () => {}) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let last = null;
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      onProgress(attempt ? `${model} завгүй байна, дахин оролдож байна…` : `${model} хураангуйлж байна…`);
      const r = await callGemini(apiKey, task, payload, model);
      if (r.ok) return { ...r, model };
      last = r;
      if (!r.retry) return r;                    // key буруу, байршил дэмжигдэхгүй гэх мэт — өөр загвар тус болохгүй
      if (r.status === 503 && attempt === 0) { await sleep(3000); continue; }
      break;                                     // 429 / 404 / timeout / дахин 503 → дараагийн загвар
    }
  }
  return { ...last, message: "Gemini-ийн бүх үнэгүй загвар одоогоор завгүй байна. Хэдэн минутын дараа дахин оролдоно уу. (" + last.message + ")" };
}

// Хураангуй, богино хариултад гүн бодолт хэрэггүй тул хурдыг нэмэхийн тулд бууруулна.
// Gemini 3.x нь thinkingLevel, 2.5 нь thinkingBudget ашигладаг (2.5-flash-д 0 = бодолтгүй).
const thinkingFor = model => (/^gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: "low" });

// Загвар хэт ачаалалтай үед хариу өгөхгүй 100+ секунд гацдаг тул хүлээлтийг хязгаарлаж, өөр загвар руу шилжинэ
const GEMINI_TIMEOUT_MS = 35_000;

async function callGemini(apiKey, task, payload, model) {
  const { image, text: input } = splitImage(payload);
  const parts = [...(image ? [{ inlineData: { mimeType: image.media_type, data: image.data } }] : []), { text: input }];
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: task.system }] },
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: task.schema, thinkingConfig: thinkingFor(model) },
      }),
    });
  } catch (e) {
    if (e?.name === "TimeoutError") return { ok: false, status: 504, retry: true, message: `${model} ${GEMINI_TIMEOUT_MS / 1000} секундэд хариу өгсөнгүй` };
    return { ok: false, status: 503, retry: true, message: "Google Gemini руу холбогдож чадсангүй" };
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const reason = j?.error?.details?.find(d => d.reason)?.reason;
    const msg = j?.error?.message || "";
    if (reason === "API_KEY_INVALID") return { ok: false, status: 401, message: "Gemini API key буруу байна" };
    if (/location is not supported/i.test(msg)) return { ok: false, status: 403, message: "Gemini API таны байршилд дэмжигдэхгүй байна" };
    if ([429, 500, 503, 504, 524, 404].includes(r.status)) return { ok: false, status: r.status, retry: true, message: `${model}: ${r.status === 429 ? "үнэгүй хязгаарт хүрлээ" : msg}` };
    return { ok: false, status: r.status, message: `Gemini алдаа ${r.status}: ${msg}` };
  }
  if (j?.promptFeedback?.blockReason) return { ok: false, status: 422, message: "Gemini хүсэлтийг хаалаа: " + j.promptFeedback.blockReason };
  const c = j?.candidates?.[0];
  if (c?.finishReason === "MAX_TOKENS") return { ok: false, status: 502, retry: true, message: "AI-ийн хариу хэт урт болж тасарлаа" };
  const text = c?.content?.parts?.filter(p => p.text && !p.thought).map(p => p.text).join("");
  if (!text) return { ok: false, status: 502, retry: true, message: `${model} хоосон хариу буцаалаа (${c?.finishReason || "?"})` };
  try { return { ok: true, data: JSON.parse(text) }; }
  catch { return { ok: false, status: 502, retry: true, message: `${model}-ийн хариу JSON биш байна` }; }
}
