// Хувийн мэдээлэл нуух, агшин (snapshot) хадгалах, сар хоорондын ялгаа олох.
// ХУР-ын хариуны бүтэц сервис бүрт өөр тул бүх функц бүтцээс хамааралгүй (generic) ажиллана.

// Хэн болохыг шууд илтгэх талбарууд: локал хадгалах болон AI руу явуулахаас өмнө хасна
const SECRET_KEY = new RegExp([
  "regnum|register|civil.?id|person.?(corp)?.?id|national.?id",                 // дугаар
  "^name$|(customer|person|owner|citizen|holder|parent|child|spouse|father|mother|family|clan|sur|given|first|last|full)_?name", // хүний нэр
  "birth|gender|sex$|nationality|ethnic",                                         // хувийн шинж
  "address|aimag|soum|district|khoroo|street|apartment|bair|toot|door",          // хаяг
  "phone|mobile|email|image|photo|picture|base64|signature",                     // холбоо барих, зураг
  "passport.?n|document.?n|card.?n|account.?n|iban|token",                        // баримт, дансны дугаар
].join("|"), "i");
const REGNUM = /[А-ЯӨҮ]{2}\d{8}/g;            // регистрийн дугаар
// улсын дугаар → үсгийг л үлдээнэ (JS-ийн \b кирилл үсгийг танихгүй тул lookaround ашиглав)
const PLATE = /(?<![\dА-ЯӨҮа-яөү])\d{4}\s?([А-ЯӨҮ]{2,3})(?![А-ЯӨҮа-яөү])/g;

export function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!SECRET_KEY.test(k)) out[k] = redact(x);
    return out;
  }
  if (typeof v === "string") return v.replace(REGNUM, "[РД]").replace(PLATE, "****$1").slice(0, 300);
  return v;
}

// Жагсаалтын мөрийг сар хооронд тааруулах тогтвортой түлхүүр
const ID_KEY = /^(id|.*(No|Number|Id|Code|Num))$/;
function itemKey(item) {
  if (item && typeof item === "object") {
    const k = Object.keys(item).find(k => ID_KEY.test(k) && ["string", "number"].includes(typeof item[k]));
    if (k) return `${k}=${item[k]}`;
  }
  return "#" + hash(JSON.stringify(item));
}
function hash(s) {
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// { a: { b: [ {id:1, x:2} ] } } → { "a.b[id=1].x": 2 }
export function flatten(v, path = "", out = {}) {
  if (Array.isArray(v)) {
    if (!v.length) out[path] = "[]";
    for (const item of v) flatten(item, `${path}[${itemKey(item)}]`, out);
  } else if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (!keys.length) out[path] = "{}";
    for (const k of keys) flatten(v[k], path ? `${path}.${k}` : k, out);
  } else out[path] = v;
  return out;
}

// Хоёр агшны ялгаа: эх сурвалж бүрт нэмэгдсэн / хасагдсан мөр, өөрчлөгдсөн утга
export function diff(prev, cur, sources) {
  const changes = [];
  for (const s of sources) {
    const a = prev?.data?.[s.id], b = cur?.data?.[s.id];
    if (a === undefined || b === undefined) continue; // аль нэг сард татагдаагүй бол харьцуулахгүй
    const fa = flatten(a), fb = flatten(b);
    const rows = p => new Set(Object.keys(p).map(k => k.match(/^(.*?\[[^\]]+\])/)?.[1]).filter(Boolean));
    const ra = rows(fa), rb = rows(fb);
    const pick = (f, row) => Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith(row)).map(([k, v]) => [k.slice(row.length + 1) || "value", v]));
    for (const r of rb) if (!ra.has(r)) changes.push({ source: s.id, name: s.name, type: "added", item: pick(fb, r) });
    for (const r of ra) if (!rb.has(r)) changes.push({ source: s.id, name: s.name, type: "removed", item: pick(fa, r) });
    for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
      const row = k.match(/^(.*?\[[^\]]+\])/)?.[1];
      if (row && (!ra.has(row) || !rb.has(row))) continue; // бүхэл мөр нэмэгдсэн/хасагдсан бол дээр орсон
      if (k in fa && k in fb && fa[k] !== fb[k]) changes.push({ source: s.id, name: s.name, type: "changed", field: k, from: fa[k], to: fb[k] });
      else if (!(k in fa) && k in fb) changes.push({ source: s.id, name: s.name, type: "changed", field: k, from: null, to: fb[k] });
      else if (k in fa && !(k in fb)) changes.push({ source: s.id, name: s.name, type: "changed", field: k, from: fa[k], to: null });
    }
  }
  return changes;
}

// --- Агшин хадгалах: сар бүрт сүүлийн татсан хувилбар, хамгийн ихдээ 13 сар ---
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export function putSnapshot(snapshots, snap) {
  const all = { ...snapshots, [monthKey(new Date(snap.takenAt))]: snap };
  return Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)).slice(-13));
}

// Өнөөдрийн агшинтай харьцуулах өмнөх сарын агшин (байхгүй бол хамгийн сүүлийн өмнөх)
export function previousSnapshot(snapshots, cur) {
  const m = monthKey(new Date(cur.takenAt));
  const older = Object.keys(snapshots).filter(k => k < m).sort();
  return older.length ? snapshots[older.at(-1)] : null;
}

// AI руу илгээх багцыг хэмжээгээр нь хязгаарлана (жагсаалт бүрээс сүүлийн 15 мөр)
export function trimForAi(v, depth = 0) {
  if (Array.isArray(v)) return v.slice(-15).map(x => trimForAi(x, depth + 1));
  if (v && typeof v === "object" && depth < 6) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trimForAi(x, depth + 1)]));
  return v;
}

// Өгөгдлийн бүтэц (утгагүй): { list[12]{year,month,paid} } — алдаа засах, дэлгэцийн зураг хуваалцахад
export function shape(v, depth = 0) {
  if (Array.isArray(v)) return `[${v.length}]` + (v.length && depth < 3 ? shape(v[0], depth + 1) : "");
  if (v && typeof v === "object") {
    const ks = Object.keys(v);
    if (depth >= 3) return `{${ks.length}}`;
    return "{" + ks.slice(0, 12).map(k => (v[k] && typeof v[k] === "object" ? k + shape(v[k], depth + 1) : k)).join(", ") + (ks.length > 12 ? ", …" : "") + "}";
  }
  return v === null ? "null" : typeof v;
}
