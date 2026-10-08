// e-Mongolia-ийн нийтэд нээлттэй үйлчилгээний жагсаалт (~1460): chatbot-ын асуултад тохирох үйлчилгээг санал болгох,
// бүрдүүлэх жагсаалтын мөрийг бодит үйлчилгээтэй тааруулахад. Нөхцөлийн дагавар үл хамаарч үг тааруулна.

// Түгээмэл бүрдүүлэлтийн мөрийг e-Mongolia дээрх албан ёсны үйлчилгээний нэр рүү хөрвүүлэх зөвлөмж (AI ажиллахгүй үед).
// Нэрсийг e-Mongolia хайлтын API-аас (2026-10-06) шууд авсан. Энд байхгүй зүйлийг ч каталогоос хайж олно.
const HINTS = [
  { keys: ["иргэний үнэмлэх", "үнэмлэхний хуулбар", "үнэмлэхийн хуулбар"], query: "Иргэний үнэмлэхийн лавлагаа" },
  { keys: ["нийгмийн даатгал", "ндш"], query: "Нийгмийн даатгалын шимтгэл төлөлтийн лавлагаа" },
  { keys: ["ял шийтгэл", "эрүүгийн", "цагдаагийн тодорхойлолт"], query: "Иргэний эрүүгийн хариуцлага хүлээж байгаа эсэх тухай тодорхойлолт" },
  { keys: ["оршин суугаа", "хаягийн тодорхойлолт", "хаягийн лавлагаа"], query: "Иргэний оршин суугаа газрын хаягийн бүртгэлийн лавлагаа" },
  { keys: ["төрсний", "төрсөн гэрчилгээ"], query: "Төрсний бүртгэлийн лавлагаа" },
  { keys: ["гэрлэсний бүртгэлгүй", "гэрлээгүй"], query: "Гэрлэсний бүртгэлгүй лавлагаа" },
  { keys: ["гэрлэсний"], query: "Гэрлэсний бүртгэлийн лавлагаа" },
  { keys: ["диплом", "боловсрол"], query: "Дээд боловсролын сургалтын байгууллагын дипломын тодорхойлолт" },
  { keys: ["жолооч", "жолоодох эрх"], query: "Жолоочийн лавлагаа, мэдээлэл" },
];

// e-Mongolia-оос авах боломжгүй, хэрэглэгч өөрөө бэлдэх зүйлс
const MANUAL = ["цээж зураг", "зураг 3x4", "3х4", "анкет", "өргөдөл", "cv", "намтар", "тодорхойлолт ажлын газраас", "зөвлөмж"];

// AI-гүй задлалт: мөр бүрийг түлхүүр үгээр. Үр дүн нь AI-ийн /parse, /plan-ийн items-тэй ижил хэлбэртэй.
export function localPlan(text) {
  return text.split(/[\n,;]+/).map(s => s.replace(/^\s*[\d.)•\-–]+\s*/, "").trim()).filter(Boolean).map(label => {
    const t = label.toLowerCase();
    if (MANUAL.some(m => t.includes(m))) return { label, source: "self", service: "", note: "Өөрөө бэлдэнэ (e-Mongolia-д байхгүй)", years: 0, subject: "self" };
    const h = HINTS.find(h => h.keys.some(k => t.includes(k)));
    return { label, source: "emongolia", service: h ? h.query : label, note: "", years: 0, subject: "self" };
  });
}

const CATALOG_URL = "https://e-mongolia.mn/portal/main-portal/api/content/search?currentPage=0&pageSize=5000&query=";
const CATALOG_TTL = 24 * 3600 * 1000;

export async function loadCatalog(force = false) {
  const { catalog, catalogAt } = await chrome.storage.local.get(["catalog", "catalogAt"]);
  if (!force && catalog?.length && Date.now() - catalogAt < CATALOG_TTL) return prepareCatalog(catalog);
  try {
    const j = await (await fetch(CATALOG_URL)).json();
    const list = (j.data?.list || []).filter(x => x.contentType === "SERVICE")
      .map(x => ({ title: x.title, path: x.path, tags: x.tags || [], popularity: x.popularity || 0 }));
    if (!list.length) throw new Error("хоосон");
    await chrome.storage.local.set({ catalog: list, catalogAt: Date.now() });
    return prepareCatalog(list);
  } catch (e) {
    if (catalog?.length) return prepareCatalog(catalog); // хуучин хуулбараар үргэлжлүүлнэ
    throw new Error("e-Mongolia-ийн үйлчилгээний жагсаалтыг татаж чадсангүй: " + e.message);
  }
}

// Баримтын төрлийг заасан үгс: хэрэглэгч «тодорхойлолт» гэвч албан нэр нь «лавлагаа» байж болно
const DOC = ["лавлагаа", "тодорхойлолт", "хуулбар", "гэрчилгээ", "баримт", "мэдээлэл", "тухай", "талаарх", "эсэх"];
// Лавлагаа биш, хүсэлт/төлбөр/захиалгын үйлчилгээг илтгэх үгс
const ACTION = ["хүсэлт", "захиалах", "төлөх", "дахин авах", "бүртгүүлэх", "сунгах", "солих", "олгох", "нөхөн"];

// Асуултын үгс: үйлчилгээ хайхад хэрэггүй
const STOP = new Set(["миний", "минийх", "надад", "би", "та", "хэр", "хэрхэн", "яаж", "ямар", "юу", "юун", "хэд", "хэдэн", "хаана",
  "байна", "байгаа", "байдаг", "вэ", "бэ", "уу", "үү", "юм", "гэж", "болох", "авах", "харах", "мэдэх", "мэдээллээ", "одоо"]);
const words = s => (s || "").toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(w => w && !STOP.has(w));
const uniq = a => [...new Set(a)];
const isDoc = w => DOC.some(d => sameWord(d, w));
const foreign = t => /гадаад хэл|англи хэл/.test(t) || !/[а-яөү]/.test(t);

// Нөхцөлийн дагавар өөр байсан ч нэг үг мөн эсэх: «үнэмлэхний» ≈ «үнэмлэхийн», «даатгалын» ≈ «даатгал»
function sameWord(a, b) {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min < 4) return false;
  let p = 0; while (p < min && a[p] === b[p]) p++;
  return p >= Math.max(4, min - 3);
}

function trigrams(s) {
  const t = ` ${words(s).join(" ")} `, g = new Set();
  for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3));
  return g;
}
function dice(A, B) {
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return A.size + B.size ? (2 * n) / (A.size + B.size) : 0;
}

export function prepareCatalog(list) {
  return list.map(s => ({ ...s, _w: words(s.title), _t: words(s.tags.join(" ")), _g: trigrams(s.title), _norm: words(s.title).join(" ") }));
}

// Каталогийн үйлчилгээ бүрт оноо өгч, шилдэг n-ийг буцаана
export function rankCatalog(item, catalog, n = 6) {
  const srcs = uniq([item.query, item.label].filter(Boolean));
  const want = srcs.join(" ").toLowerCase();
  const ws = uniq(words(want));
  const topic = ws.filter(w => !isDoc(w)).length ? ws.filter(w => !isDoc(w)) : ws;
  const grams = srcs.map(trigrams);
  const norms = srcs.map(s => words(s).join(" "));
  const foreignOk = /гадаад|англи|foreign|english/.test(want);
  const actionOk = ACTION.some(a => want.includes(a));
  const wantRef = ws.some(isDoc);

  return catalog.map(s => {
    const inTitle = topic.filter(q => s._w.some(t => sameWord(q, t))).length / topic.length;
    const inAny = topic.filter(q => s._w.some(t => sameWord(q, t)) || s._t.some(t => sameWord(q, t))).length / topic.length;
    if (!inAny) return null;
    const cover = Math.max(inTitle, 0.85 * inAny);
    const sim = Math.max(...grams.map(g => dice(g, s._g)));
    let score = 0.55 * cover + 0.35 * sim;
    const t = s.title.toLowerCase();
    if (norms.includes(s._norm)) score += 0.3;
    if (wantRef && /лавлагаа|тодорхойлолт/.test(t)) score += 0.1;
    if (!foreignOk && foreign(t)) score -= 0.3;
    if (!actionOk && ACTION.some(a => t.includes(a))) score -= 0.2;
    score += 0.05 * Math.min(1, Math.log10(s.popularity + 1) / 7);
    return { title: s.title, path: s.path, score: Math.round(score * 100) / 100, action: !actionOk && ACTION.some(a => t.includes(a)) };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, n);
}

// Асуултад хамгийн тохирох үйлчилгээнүүд: [{ title, path }]
export async function findServices(question, n = 5) {
  try { return rankCatalog({ query: question }, await loadCatalog(), n).map(({ title, path }) => ({ title, path })); }
  catch { return []; } // жагсаалт татагдахгүй бол chatbot үйлчилгээ санал болгохгүйгээр хариулна
}

// AI-д санал болгох e-Mongolia-ийн лавлагаа, тодорхойлолтууд (түгээмэл нь эхэндээ). Гадаад хэлний хувилбаруудыг оруулна (визэнд хэрэгтэй).
export async function referenceTitles(n = 150) {
  try {
    const cat = await loadCatalog();
    return cat.filter(s => /лавлагаа|тодорхойлолт/i.test(s.title) && !/хуулийн этгээд|ААН|байгууллагын/i.test(s.title))
      .sort((a, b) => b.popularity - a.popularity).slice(0, n).map(s => s.title);
  } catch { return []; }
}

// Итгэлтэй бол шилдгийг нь буцаана, үгүй бол null (хэрэглэгчээс асууна)
export function confidentPick(ranked) {
  const [a, b] = ranked;
  if (!a || a.action || a.score < 0.6) return null;
  if (b && a.score - b.score < 0.08) return null;
  return { title: a.title, path: a.path };
}

// AI-ийн бичсэн үйлчилгээний нэрийг каталогтой тааруулна: яг ижил нэр → шууд, үгүй бол итгэлтэй таарвал
export async function matchService(name) {
  if (!name) return null;
  const cat = await loadCatalog();
  const exact = cat.find(s => s.title === name);
  if (exact) return { title: exact.title, path: exact.path };
  return confidentPick(rankCatalog({ query: name }, cat, 2));
}

// Итгэлтэй таараагүй мөрийн сонголтууд (хэрэглэгч сонгоно): [{ title, path }]
export async function candidates(item, n = 6) {
  return rankCatalog(item, await loadCatalog(), n).map(({ title, path }) => ({ title, path }));
}

// Хэрэглэгчийн өмнө сонгосон тааруулалтыг санах түлхүүр
export const learnKey = label => words(label).join(" ");
