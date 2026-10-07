import { HINTS, localPlan, loadCatalog, rankCatalog, confidentPick, learnKey } from "./services.js";

const $ = id => document.getElementById(id);
let plan = []; // [{ label, query|null, note, state, match:{title,path}, candidates, downloadId, url }]
let catalog = null;

const store = await chrome.storage.local.get(["worker", "onRepeat"]);
$("onRepeat").value = store.onRepeat || "new";
$("onRepeat").onchange = () => chrome.storage.local.set({ onRepeat: $("onRepeat").value });
$("worker").value = store.worker || "";
$("worker").onchange = () => chrome.storage.local.set({ worker: $("worker").value.trim() });
const worker = () => $("worker").value.trim();

$("openEm").onclick = () => chrome.runtime.sendMessage({ type: "OPEN_EM" });

const fileToB64 = f => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(f); });
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

$("analyze").onclick = async () => {
  const text = $("list").value.trim();
  const img = $("img").files[0];
  if (!text && !img) return;
  $("analyze").disabled = true; $("aiNote").textContent = "Шинжилж байна…";
  try {
    if (worker()) {
      const body = { text, hints: HINTS.map(h => h.query) };
      if (img) body.image = { media_type: img.type, data: await fileToB64(img) };
      const res = await fetch(worker().replace(/\/$/, "") + "/parse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text());
      plan = (await res.json()).items.map(i => ({ ...i, origQuery: i.query, state: "idle" }));
      $("aiNote").textContent = `AI ${plan.length} мөр олов`;
    } else {
      if (!text) throw new Error("AI-гүй горимд зураг уншихгүй — текстээр бичнэ үү");
      plan = localPlan(text).map(i => ({ ...i, origQuery: i.query, state: "idle" }));
      $("aiNote").textContent = "Түлхүүр үгээр задлав (AI-гүй)";
    }
    $("aiNote").textContent += " · e-Mongolia-тай тааруулж байна…";
    catalog ||= await loadCatalog();
    await Promise.all(plan.filter(p => p.query).map(matchItem));
    $("aiNote").textContent = $("aiNote").textContent.replace(" · e-Mongolia-тай тааруулж байна…", "");
  } catch (e) {
    $("aiNote").textContent = "Алдаа: " + e.message;
  }
  $("analyze").disabled = false;
  render();
};

// Нэг мөрийг e-Mongolia-ийн бодит үйлчилгээний нэртэй тааруулах
async function matchItem(p) {
  catalog ||= await loadCatalog();
  const { learned = {} } = await chrome.storage.local.get("learned");
  Object.assign(p, { match: null, candidates: [], showAlt: false, url: null });
  const saved = learned[learnKey(p.label)];
  if (saved && p.query === p.origQuery) { p.match = saved; p.state = "idle"; return; }
  p.candidates = rankCatalog(p, catalog);
  p.match = worker() ? await aiPick(p) : confidentPick(p.candidates);
  p.state = p.match ? "idle" : p.candidates.length ? "CHOOSE" : "NOT_FOUND";
}

async function aiPick(p) {
  if (!p.candidates.length) return null;
  try {
    const r = await fetch(worker().replace(/\/$/, "") + "/pick", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `${p.query} (жагсаалтад: ${p.label})`, results: p.candidates.map(c => c.title) }),
    });
    const { index } = await r.json();
    return p.candidates[index] || null;
  } catch { return confidentPick(p.candidates); }
}

// Хэрэглэгч сонгосон бол дараагийн удаа автоматаар ашиглахаар санана
async function choose(i, c) {
  const p = plan[i];
  const { learned = {} } = await chrome.storage.local.get("learned");
  learned[learnKey(p.label)] = { title: c.title, path: c.path };
  await chrome.storage.local.set({ learned });
  Object.assign(p, { match: { title: c.title, path: c.path }, state: "idle", showAlt: false, url: null });
  render();
}

const STATUS = {
  idle: ["muted", "Татахад бэлэн"],
  run: ["warn", "e-Mongolia-оос татаж байна…"],
  done: ["ok", "✓ Татагдсан"],
  NOT_LOGGED_IN: ["err", "e-Mongolia-д нэвтрээгүй байна. Нэвтрээд дахин оролдоно уу."],
  CHOOSE: ["warn", "Аль нь вэ? Доороос сонгоно уу. Сонголтыг тань дараа нь санана."],
  NOT_FOUND: ["warn", "e-Mongolia-оос олдсонгүй. «хайх» нэрийг өөр үгээр бичээд Enter дарна уу."],
  PAID: ["warn", "Төлбөртэй үйлчилгээ — автоматаар авахгүй. Хуудсыг нээж өөрөө шийднэ үү."],
  NOT_INSTANT: ["warn", "Шууд гардаггүй (хүсэлт илгээдэг) үйлчилгээ — өөрөө шалгана уу."],
  REPEAT: ["warn", "Энэ лавлагааг саяхан авсан байна. «Хуудсыг нээх» дарж өмнөхийг харах эсвэл шинээр авна уу."],
  NEEDS_INPUT: ["warn", "Энэ үйлчилгээ нэмэлт мэдээлэл асууж байна. «Хуудсыг нээх» дарж өөрөө бөглөнө үү."],
};

function render() {
  if (!plan.length) { $("items").textContent = "Жагсаалт хоосон."; return; }
  $("items").innerHTML = "";
  plan.forEach((p, i) => {
    const div = document.createElement("div");
    div.className = "item";
    if (!p.query) {
      div.innerHTML = `<div class="name">${esc(p.label)}</div><div class="status muted">${esc(p.note || "Өөрөө бэлдэнэ")}</div>`;
      $("items").append(div); return;
    }
    const [cls, txt] = STATUS[p.state] || ["err", p.state];
    div.innerHTML = `<div class="name">${esc(p.label)}</div>
      <div class="muted" style="font-size:12px">хайх: <input data-i="${i}" class="q" value="${esc(p.query)}" style="width:70%;background:transparent;color:inherit;border:0;border-bottom:1px dashed var(--line);font:inherit"></div>
      ${p.match ? `<div style="font-size:12px">→ ${esc(p.match.title)}</div>` : ""}
      <div class="status ${cls}">${esc(txt)}</div>`;
    if (p.state !== "done" && p.state !== "run" && (p.state === "CHOOSE" || p.showAlt)) {
      const alt = document.createElement("div"); alt.className = "alts";
      p.candidates.forEach(c => {
        const b = document.createElement("button"); b.className = "ghost alt"; b.textContent = c.title;
        b.onclick = () => choose(i, c); alt.append(b);
      });
      const none = document.createElement("button"); none.className = "ghost alt muted"; none.textContent = "Аль нь ч биш — өөрөө бүрдүүлнэ";
      none.onclick = () => { Object.assign(p, { query: null, note: "Өөрөө бүрдүүлнэ" }); render(); };
      alt.append(none); div.append(alt);
    }
    const row = document.createElement("div"); row.className = "row";
    if (p.match && p.state !== "done" && p.state !== "run") {
      const go = document.createElement("button"); go.textContent = p.state === "idle" ? "Татах" : "Дахин оролдох";
      go.onclick = () => runOne(i); row.append(go);
      if (!p.showAlt) {
        const other = document.createElement("button"); other.className = "ghost"; other.textContent = "Өөр үйлчилгээ сонгох";
        other.onclick = async () => { if (!p.candidates.length) p.candidates = rankCatalog(p, catalog ||= await loadCatalog()); p.showAlt = true; render(); };
        row.append(other);
      }
    }
    if (p.url && p.state !== "done") {
      const open = document.createElement("button"); open.className = "ghost"; open.textContent = "Хуудсыг нээх";
      open.onclick = () => chrome.runtime.sendMessage({ type: "OPEN_URL", url: p.url }); row.append(open);
    }
    div.append(row);
    $("items").append(div);
  });
  document.querySelectorAll("input.q").forEach(inp => inp.onchange = async () => {
    const p = plan[+inp.dataset.i]; p.query = inp.value.trim(); await matchItem(p); render();
  });
  $("collectAll").disabled = !plan.some(p => p.query && p.match && p.state !== "done");
  renderOut();
}

function renderOut() {
  const done = plan.filter(p => p.state === "done");
  const manual = plan.filter(p => !p.query || !["done", "idle", "run", "CHOOSE"].includes(p.state));
  if (!done.length && !manual.length) return;
  $("out").innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:6px">${done.length}/${plan.length} бэлэн · Downloads/Burduulelt</div>`;
  done.forEach(p => {
    const row = document.createElement("div"); row.className = "row";
    const name = document.createElement("span"); name.textContent = p.match?.title || p.label; name.style.flex = "1";
    const open = document.createElement("button"); open.textContent = "Нээх / Хэвлэх";
    open.onclick = () => chrome.runtime.sendMessage({ type: "OPEN_FILE", id: p.downloadId });
    const show = document.createElement("button"); show.className = "ghost"; show.textContent = "Хавтас";
    show.onclick = () => chrome.runtime.sendMessage({ type: "SHOW_FILE", id: p.downloadId });
    row.append(name, open, show); $("out").append(row);
  });
  if (manual.length) {
    const m = document.createElement("div"); m.style.marginTop = "10px";
    m.innerHTML = `<div class="warn" style="font-size:12px">Өөрөө бүрдүүлэх:</div>` +
      manual.map(p => `<div style="font-size:13px">• ${esc(p.label)}</div>`).join("");
    $("out").append(m);
  }
}

async function runOne(i) {
  const p = plan[i]; p.state = "run"; render();
  const r = await chrome.runtime.sendMessage({ type: "COLLECT", item: p.match, index: i });
  Object.assign(p, { state: r.ok ? "done" : r.error, downloadId: r.downloadId, url: r.url });
  render();
}

$("collectAll").onclick = async () => {
  $("collectAll").disabled = true;
  for (let i = 0; i < plan.length; i++) if (plan[i].query && plan[i].match && plan[i].state !== "done") await runOne(i);
  render();
};

$("forget").onclick = async () => { await chrome.storage.local.remove(["learned", "catalog", "catalogAt"]); catalog = null; $("forget").textContent = "Мартлаа ✓"; };
