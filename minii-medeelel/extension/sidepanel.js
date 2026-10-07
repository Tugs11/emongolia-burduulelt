import { SOURCES } from "./sources.js";
import { redact, diff, putSnapshot, previousSnapshot, trimForAi, shape } from "./lib.js";
import { summarize, summarizeGemini } from "./ai.js";
import Anthropic from "./vendor/anthropic.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = v => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
const today = () => new Date().toISOString().slice(0, 10);

// Тохиргоо
const cfg = await chrome.storage.local.get(["provider", "geminiKey", "apiKey", "worker", "appToken"]);
for (const id of ["geminiKey", "apiKey"]) {
  $(id).value = cfg[id] || "";
  $(id).onchange = () => chrome.storage.local.set({ [id]: $(id).value.trim() });
}
$("provider").value = cfg.provider || "gemini";
const PRIVACY = {
  gemini: "Анхаар: Gemini-ийн үнэгүй хувилбарт Google илгээсэн мэдээллийг бүтээгдэхүүнээ сайжруулахад ашиглаж, хүн уншиж магадгүй. Нэр, РД, хаягийг хассан ч даатгал, зээлийн мэдээлэл очно.",
  claude: "", worker: "",
};
function showProvider() {
  const p = $("provider").value;
  document.querySelectorAll("[data-p]").forEach(el => (el.style.display = el.dataset.p === p ? "" : "none"));
  $("privacyNote").textContent = PRIVACY[p];
}
$("provider").onchange = () => { chrome.storage.local.set({ provider: $("provider").value }); showProvider(); };
showProvider();
$("worker").value = cfg.worker || "";
$("appToken").value = cfg.appToken || "";
$("worker").onchange = () => chrome.storage.local.set({ worker: $("worker").value.trim() });
$("appToken").onchange = () => chrome.storage.local.set({ appToken: $("appToken").value.trim() });

$("openEm").onclick = () => chrome.tabs.create({ url: "https://e-mongolia.mn/home" });
$("wipe").onclick = async () => {
  if (!confirm("Хадгалсан бүх сарын мэдээлэл, AI хураангуйг устгах уу?")) return;
  await chrome.storage.local.remove(["snapshots", "last"]);
  location.reload();
};

let state = (await chrome.storage.local.get("last")).last || null; // { snap, prevTakenAt, changes, summary }
render();

// 1. e-Mongolia-оос мэдээлэл татах
$("refresh").onclick = async () => {
  $("refresh").disabled = true;
  $("refreshNote").textContent = "Татаж байна…";
  try {
    const [tab] = await chrome.tabs.query({ url: "https://e-mongolia.mn/*" });
    if (!tab) throw new Error("e-Mongolia таб нээлттэй алга. «e-Mongolia нээх» дарж нэвтэрнэ үү.");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const res = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT", sources: SOURCES });
    if (res?.error === "NOT_LOGGED_IN") throw new Error("e-Mongolia-д нэвтрээгүй байна (эсвэл session дууссан). Дахин нэвтэрнэ үү.");

    const snap = { takenAt: new Date().toISOString(), data: {}, status: {} };
    for (const s of SOURCES) {
      const r = res.results[s.id];
      snap.status[s.id] = r.ok ? { ok: true } : { ok: false, error: r.error };
      if (r.ok) snap.data[s.id] = redact(r.data); // хувийн танигдах мэдээллийг хадгалахаас өмнө хасна
    }
    const { snapshots = {} } = await chrome.storage.local.get("snapshots");
    const all = putSnapshot(snapshots, snap);
    const prev = previousSnapshot(all, snap);
    state = { snap, prevTakenAt: prev?.takenAt || null, changes: prev ? diff(prev, snap, SOURCES) : null, summary: null };
    await chrome.storage.local.set({ snapshots: all, last: state });
    $("refreshNote").textContent = "";
  } catch (e) {
    $("refreshNote").textContent = e.message;
  }
  $("refresh").disabled = false;
  render();
};

// 2. AI руу илгээх багц: өнөөдрийн огноо, мэдээлэл (нууцалсан), өмнөх сартай харьцуулсан ялгаа
function aiPayload() {
  if (!state?.snap) return null;
  return {
    today: today(),
    previousSnapshotDate: state.prevTakenAt?.slice(0, 10) || null,
    sources: SOURCES.filter(s => s.id in state.snap.data).map(s => ({ name: s.name, data: trimForAi(state.snap.data[s.id]) })),
    unavailable: SOURCES.filter(s => !(s.id in state.snap.data)).map(s => s.name),
    changesSincePreviousMonth: state.changes ? state.changes.slice(0, 80) : null,
  };
}

// Сонгосон AI үйлчилгээгээр хураангуйлна
async function runAi(payload) {
  const provider = $("provider").value;
  if (provider === "gemini") {
    const key = $("geminiKey").value.trim();
    if (!key) throw new Error("Тохиргоо хэсэгт Gemini API key оруулна уу (aistudio.google.com-оос үнэгүй).");
    const r = await summarizeGemini(key, payload, msg => ($("summary").textContent = msg));
    if (!r.ok) throw new Error(r.message);
    return { ...r.data, model: r.model };
  }
  if (provider === "claude") {
    const apiKey = $("apiKey").value.trim();
    if (!apiKey) throw new Error("Тохиргоо хэсэгт Claude API key оруулна уу.");
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const r = await summarize(Anthropic, client, payload);
    if (!r.ok) throw new Error(r.message);
    return r.data;
  }
  const worker = $("worker").value.trim().replace(/\/$/, "");
  if (!worker) throw new Error("Тохиргоо хэсэгт Worker URL оруулна уу.");
  const r = await fetch(worker + "/summarize", {
    method: "POST",
    headers: { "content-type": "application/json", "x-app-token": $("appToken").value.trim() },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

$("summarize").onclick = async () => {
  $("summarize").disabled = true;
  $("summary").textContent = "AI хураангуйлж байна… (10–40 секунд)";
  try {
    state.summary = { ...(await runAi(aiPayload())), at: new Date().toISOString() };
    await chrome.storage.local.set({ last: state });
  } catch (e) {
    $("summary").innerHTML = `<span class="err">Алдаа: ${esc(e.message)}</span>`;
    $("summarize").disabled = false;
    return;
  }
  render();
};

function render() {
  const snap = state?.snap;
  $("summarize").disabled = !snap || !Object.keys(snap.data).length;
  $("preview").textContent = snap ? JSON.stringify(aiPayload(), null, 2) : "";

  // Эх сурвалж бүрийн төлөв
  $("status").innerHTML = snap
    ? `<div class="muted">Сүүлд татсан: ${esc(snap.takenAt.slice(0, 16).replace("T", " "))}</div>` +
      SOURCES.map(s => {
        const st = snap.status[s.id];
        const detail = st?.ok ? shape(snap.data[s.id]) : st?.error;
        return `<div>${st?.ok ? `<span class="ok">✓</span>` : `<span class="err">✗</span>`} ${esc(s.name)} <span class="muted" style="font-size:11px">${esc(detail)}</span></div>`;
      }).join("")
    : "";

  // AI хураангуй
  const sm = state?.summary;
  if (sm) {
    $("summary").classList.remove("muted");
    $("summary").innerHTML = `<div style="font-weight:600;margin-bottom:6px">${esc(sm.headline)}</div>` +
      (sm.model ? `<div class="small muted" style="margin-bottom:4px">${esc(sm.model)} · ${esc(sm.at?.slice(0, 16).replace("T", " "))}</div>` : "") +
      sm.alerts.map(a => `<div class="alert ${esc(a.level)}"><b>${esc(a.title)}</b>${esc(a.detail)}${a.action ? `<div class="small muted">→ ${esc(a.action)}</div>` : ""}</div>`).join("") +
      (sm.changes.length ? `<div class="small muted" style="margin-top:8px">Өөрчлөлт:</div>` + sm.changes.map(c => `<div class="small">• <b>${esc(c.area)}:</b> ${esc(c.summary)}</div>`).join("") : "") +
      (sm.ok.length ? `<div class="small muted" style="margin-top:8px">Хэвийн:</div>` + sm.ok.map(o => `<div class="small ok">✓ ${esc(o)}</div>`).join("") : "");
  }

  // Өмнөх сараас өөрчлөгдсөн зүйлс (AI-гүй, кодоор тооцсон)
  const ch = state?.changes;
  if (ch) {
    const head = `<div class="muted" style="margin-bottom:6px">${esc(state.prevTakenAt.slice(0, 10))} → ${esc(snap.takenAt.slice(0, 10))} · ${ch.length} өөрчлөлт</div>`;
    $("changes").classList.remove("muted");
    $("changes").innerHTML = head + (ch.length ? ch.map(c => {
      const what = c.type === "added" ? `<span class="warn">Шинэ:</span> ${esc(fmt(c.item))}`
        : c.type === "removed" ? `<span class="muted">Хасагдсан:</span> ${esc(fmt(c.item))}`
        : `${esc(c.field)}: ${esc(fmt(c.from))} → <b>${esc(fmt(c.to))}</b>`;
      return `<div class="chg"><span class="muted">${esc(c.name)} ·</span> ${what}</div>`;
    }).join("") : `<div class="ok">Өөрчлөлт алга.</div>`);
  }
}
