import { SOURCES, buildSources } from "./sources.js";
import { redact, diff, putSnapshot, previousSnapshot, trimForAi, shape } from "./lib.js";
import { findServices, referenceTitles, matchService } from "./catalog.js";
import { SERVICE_URL } from "./config.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const show = (id, on = true) => $(id).classList.toggle("hidden", !on);
const status = (text, cls = "muted") => { $("status").className = `small ${cls}`; $("status").textContent = text; };

const SUGGESTIONS = [
  "Солонгос руу жуулчны виз мэдүүлэх бичиг баримт бүрдүүлэх",
  "Миний цэргийн алба хаасан мэдээлэл хэр байна?",
  "НДШ хэдэн сар төлөгдсөн бэ?",
  "Зээлийн үлдэгдэл хэд вэ?",
  "Паспорт хэзээ дуусах вэ?",
];

// Өмнөх хувилбарын тохиргоо (хэрэглэгчийн Gemini/Claude key гэх мэт) хэрэггүй болсон тул устгана
await chrome.storage.local.remove(["provider", "geminiKey", "apiKey", "worker", "appToken"]);

let state = (await chrome.storage.local.get("last")).last || null; // { snap, prevTakenAt, changes, summary }
let chat = []; // [{ role: "user" | "assistant", text, links? }] — зөвхөн энэ цонхонд, хадгалахгүй

$("openEm").onclick = () => chrome.tabs.create({ url: "https://e-mongolia.mn/home" });
render();

// e-Mongolia-оос мэдээлэл татах явц (content.js-ээс)
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === "PROGRESS") status(`e-Mongolia-оос мэдээлэл татаж байна… (${msg.done + 1}/${msg.total}) ${msg.name}`);
});

async function service(path, payload) {
  const r = await fetch(SERVICE_URL + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// «Шинжлэх»: мэдээлэл татах → нууцалж хадгалах → AI хураангуй
$("analyze").onclick = async () => {
  $("analyze").disabled = true;
  show("openEm", false);
  try {
    const [tab] = await chrome.tabs.query({ url: "https://e-mongolia.mn/*" });
    if (!tab) { show("openEm"); throw new Error("e-Mongolia нээлттэй алга. «e-Mongolia нээх» дарж нэвтрээд дахин «Шинжлэх» дарна уу."); }
    status("e-Mongolia-оос мэдээлэл татаж байна…");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const res = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT", sources: buildSources() });
    if (res?.error === "NOT_LOGGED_IN") { show("openEm"); throw new Error("e-Mongolia-д нэвтрээгүй байна (эсвэл session дууссан). Нэвтрээд дахин «Шинжлэх» дарна уу."); }

    const snap = { takenAt: new Date().toISOString(), data: {}, status: {} };
    for (const s of SOURCES) {
      const r = res.results[s.id];
      snap.status[s.id] = r.ok ? { ok: true, note: r.note } : { ok: false, error: r.error };
      if (r.ok) snap.data[s.id] = redact(r.data); // хувийн танигдах мэдээллийг хадгалахаас өмнө хасна
    }
    if (!Object.keys(snap.data).length) throw new Error("Мэдээлэл татагдсангүй. e-Mongolia-д нэвтэрсэн эсэхээ шалгана уу.");

    // Сар бүрийн агшинг хадгална: дараа сараас өмнөх сартай харьцуулсан өөрчлөлтийг AI хураангуйд оруулна
    const { snapshots = {} } = await chrome.storage.local.get("snapshots");
    const all = putSnapshot(snapshots, snap);
    const prev = previousSnapshot(all, snap);
    state = { snap, prevTakenAt: prev?.takenAt || null, changes: prev ? diff(prev, snap, SOURCES) : null, summary: null };
    chat = [];
    await chrome.storage.local.set({ snapshots: all, last: state });
    render();

    status("AI хураангуйлж байна… (10–40 секунд)");
    state.summary = { ...(await service("/summarize", aiPayload())), at: new Date().toISOString() };
    await chrome.storage.local.set({ last: state });
    status(`Шинжилсэн: ${state.summary.at.slice(0, 16).replace("T", " ")}`);
  } catch (e) {
    status(e.message, "err");
  }
  $("analyze").disabled = false;
  render();
};

// AI руу илгээх мэдээлэл (нууцалсан): эх сурвалж бүрийн өгөгдөл, татагдаагүй эх сурвалжууд, өмнөх сартай харьцуулсан ялгаа
function aiPayload() {
  const s = state.snap;
  return {
    today: today(),
    previousSnapshotDate: state.prevTakenAt?.slice(0, 10) || null,
    sources: SOURCES.filter(x => x.id in s.data).map(x => ({ name: x.name, data: trimForAi(s.data[x.id]) ?? s.status[x.id]?.note ?? null })),
    unavailable: SOURCES.filter(x => !(x.id in s.data)).map(x => x.name),
    changesSincePreviousMonth: state.changes ? state.changes.slice(0, 80) : null,
  };
}

// Chatbot: татсан мэдээлэл + хураангуй + асуултад тохирох e-Mongolia үйлчилгээнүүдийг илгээнэ
async function ask(question) {
  question = question.trim();
  if (!question || !state?.snap) return;
  $("question").value = "";
  chat.push({ role: "user", text: question });
  chat.push({ role: "assistant", text: "…", pending: true });
  $("send").disabled = true;
  renderChat();
  try {
    const services = await findServices(question);
    const { sources, unavailable } = aiPayload();
    const r = await service("/chat", {
      today: today(),
      question,
      history: chat.filter(m => !m.pending).slice(-7, -1).map(({ role, text }) => ({ role, text })),
      data: { sources, unavailable },
      summary: state.summary ? { headline: state.summary.headline, alerts: state.summary.alerts } : null,
      services: services.map(s => s.title),
    });
    // AI зөвхөн бидний өгсөн нэрсээс сонгоно; холбоосыг энд (AI биш) үүсгэнэ
    const links = (r.services || []).map(t => services.find(s => s.title === t)).filter(Boolean);
    const msg = { role: "assistant", text: r.answer, links };
    chat[chat.length - 1] = msg;
    if (r.intent === "documents" && r.purpose) { msg.plan = { loading: true }; renderChat(); await makePlan(msg, r.purpose, question); }
  } catch (e) {
    chat[chat.length - 1] = { role: "assistant", text: "Алдаа: " + e.message, error: true };
  }
  $("send").disabled = false;
  renderChat();
}

// --- Бичиг баримт бүрдүүлэх (Бүрдүүлэлт AI) ------------------------------------
// AI жагсаалт гаргана → e-Mongolia-оос авах зүйлсийг каталогтой тааруулна → «Цуглуулах» дарахад PDF-ээр татна
async function makePlan(msg, purpose, question) {
  try {
    const p = await service("/plan", { today: today(), purpose, question, emongoliaServices: await referenceTitles() });
    const em = [], self = [];
    for (const it of p.items) {
      const match = it.source === "emongolia" ? await matchService(it.service) : null;
      if (match) em.push({ label: it.label, match, years: it.years || 0, state: "idle" });
      else self.push({ label: it.label, note: it.note || (it.source === "emongolia" ? "e-Mongolia-оос олдсонгүй — өөрөө авна" : "") });
    }
    msg.plan = { title: p.title || purpose, folder: p.title || purpose, addressee: p.addressee || "", em, self, tips: p.tips || [] };
  } catch (e) {
    msg.plan = { error: "Жагсаалт гаргаж чадсангүй: " + e.message };
  }
  renderChat();
}

const DOC_STATUS = {
  idle: ["muted", ""], run: ["warn", "татаж байна…"], done: ["ok", "✓ татагдсан"],
  NOT_LOGGED_IN: ["err", "e-Mongolia-д нэвтрээгүй байна"],
  PAID: ["warn", "төлбөртэй — өөрөө шийднэ"], NOT_INSTANT: ["warn", "шууд гардаггүй — өөрөө хүсэлт гаргана"],
  NEEDS_INPUT: ["warn", "маягтыг өөрөө бөглөнө"],
};

async function collectPlan(plan) {
  plan.running = true; renderChat();
  for (const [i, d] of plan.em.entries()) {
    if (d.state === "done") continue;
    d.state = "run"; renderChat();
    const item = { ...d.match, fill: { years: d.years, addressee: plan.addressee } };
    const r = await chrome.runtime.sendMessage({ type: "COLLECT_DOC", item, index: i, folder: plan.folder });
    Object.assign(d, { state: r?.ok ? "done" : r?.error || "алдаа", detail: r?.detail, downloadId: r?.downloadId, url: r?.url });
    if (r?.error === "NOT_LOGGED_IN") break;
    renderChat();
  }
  plan.running = false; renderChat();
}

function planHtml(plan, mi) {
  if (plan.loading) return `<div class="small muted" style="margin-top:6px">Бичиг баримтын жагсаалт гаргаж байна…</div>`;
  if (plan.error) return `<div class="small err" style="margin-top:6px">${esc(plan.error)}</div>`;
  const done = plan.em.filter(d => d.state === "done");
  return `<div class="plan">
    <div style="font-weight:600;margin:8px 0 4px">${esc(plan.title)}</div>
    <div class="small muted">e-Mongolia-оос цуглуулах (${done.length}/${plan.em.length})${plan.addressee ? ` · «Хаана зориулж»: ${esc(plan.addressee)}` : ""}:</div>
    ${plan.em.map((d, i) => {
      const [cls, txt] = DOC_STATUS[d.state] || ["err", d.state];
      const yrs = d.years ? ` <span class="muted small">(${new Date().getFullYear() - d.years}–${new Date().getFullYear()})</span>` : "";
      return `<div class="doc">• ${esc(d.match.title)}${yrs} <span class="${cls}">${esc(txt)}${d.detail ? ` (${esc(d.detail)})` : ""}</span>
        ${d.state === "done" ? `<button type="button" class="ghost mini" data-act="open" data-m="${mi}" data-i="${i}">Нээх</button>` : ""}
        ${d.url && d.state !== "done" ? `<button type="button" class="ghost mini" data-act="page" data-m="${mi}" data-i="${i}">Хуудсыг нээх</button>` : ""}</div>`;
    }).join("")}
    ${plan.em.length && done.length < plan.em.length ? `<button type="button" class="mini" data-act="collect" data-m="${mi}" ${plan.running ? "disabled" : ""} style="margin-top:6px">${plan.running ? "Цуглуулж байна…" : "Цуглуулах"}</button>` : ""}
    ${done.length ? `<div class="small muted" style="margin-top:4px">Downloads/Burduulelt хавтаст хадгалагдсан <button type="button" class="ghost mini" data-act="folder" data-m="${mi}">Хавтас</button></div>` : ""}
    ${plan.self.length ? `<div class="small muted" style="margin-top:8px">Өөрөө бэлдэх:</div>` + plan.self.map(x => `<div class="doc">• <b>${esc(x.label)}</b>${x.note ? ` <span class="muted">— ${esc(x.note)}</span>` : ""}</div>`).join("") : ""}
    ${plan.tips.length ? `<div class="small muted" style="margin-top:8px">Зөвлөмж:</div>` + plan.tips.map(t => `<div class="small">• ${esc(t)}</div>`).join("") : ""}
    <div class="small warn" style="margin-top:8px">Шаардлага өөрчлөгддөг тул элчин сайдын яам / визийн төвийн албан ёсны жагсаалтаас заавал шалгана уу.</div>
  </div>`;
}

$("messages").onclick = e => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const plan = chat[+b.dataset.m]?.plan, d = plan?.em[+b.dataset.i];
  if (b.dataset.act === "collect") collectPlan(plan);
  if (b.dataset.act === "open") chrome.runtime.sendMessage({ type: "OPEN_FILE", id: d.downloadId });
  if (b.dataset.act === "page") chrome.tabs.create({ url: d.url });
  if (b.dataset.act === "folder") chrome.runtime.sendMessage({ type: "SHOW_FILE", id: plan.em.find(x => x.downloadId)?.downloadId });
};
$("askForm").onsubmit = e => { e.preventDefault(); ask($("question").value); };

function renderChat() {
  const keep = $("messages").scrollTop + $("messages").clientHeight >= $("messages").scrollHeight - 30; // доод хэсэгт байсан бол дагана
  $("messages").innerHTML = chat.map((m, mi) =>
    `<div class="msg ${m.role === "user" ? "user" : "ai"}${m.error ? " err" : ""}${m.plan ? " wide" : ""}">${esc(m.text)}` +
    (m.links || []).map(l => `<a href="https://e-mongolia.mn${esc(l.path)}" target="_blank">→ ${esc(l.title)}</a>`).join("") +
    (m.plan ? planHtml(m.plan, mi) : "") +
    `</div>`).join("");
  if (keep) $("messages").scrollTop = $("messages").scrollHeight;
  $("chips").innerHTML = chat.length ? "" : SUGGESTIONS.map(q => `<button type="button" class="ghost">${esc(q)}</button>`).join("");
  $("chips").querySelectorAll("button").forEach(b => (b.onclick = () => ask(b.textContent)));
}

function render() {
  const snap = state?.snap, sm = state?.summary;
  show("summaryCard", !!sm);
  show("chatCard", !!sm);
  show("detailsBox", !!snap);
  if (!snap) return;

  if (sm) {
    $("summary").innerHTML = `<div style="font-weight:600;margin-bottom:6px">${esc(sm.headline)}</div>` +
      sm.alerts.map(a => `<div class="alert ${esc(a.level)}"><b>${esc(a.title)}</b>${esc(a.detail)}${a.action ? `<div class="small muted">→ ${esc(a.action)}</div>` : ""}</div>`).join("") +
      (sm.changes?.length ? `<div class="small muted" style="margin-top:8px">Өмнөх сараас өөрчлөгдсөн:</div>` + sm.changes.map(c => `<div class="small">• <b>${esc(c.area)}:</b> ${esc(c.summary)}</div>`).join("") : "") +
      (sm.ok?.length ? `<div class="small muted" style="margin-top:8px">Хэвийн:</div>` + sm.ok.map(o => `<div class="small ok">✓ ${esc(o)}</div>`).join("") : "");
    renderChat();
    if (!$("status").textContent) status(`Сүүлд шинжилсэн: ${sm.at.slice(0, 16).replace("T", " ")}`);
  }

  // Дэлгэрэнгүй: эх сурвалж бүрийн төлөв (зөвхөн бүтэц) ба AI руу илгээх өгөгдөл
  $("sources").innerHTML = `<div class="muted">Татсан: ${esc(snap.takenAt.slice(0, 16).replace("T", " "))}</div>` + SOURCES.map(s => {
    const st = snap.status[s.id];
    const detail = !st ? "шалгаагүй" : !st.ok ? st.error : st.note ? `мэдээлэл алга (${st.note})` : shape(snap.data[s.id]);
    return `<div>${st?.ok ? `<span class="ok">✓</span>` : `<span class="err">✗</span>`} ${esc(s.name)} <span class="muted" style="font-size:11px">${esc(detail)}</span></div>`;
  }).join("");
  $("preview").textContent = JSON.stringify(aiPayload(), null, 2);
}
