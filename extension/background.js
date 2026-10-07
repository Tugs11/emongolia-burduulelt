chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const ORIGIN = "https://e-mongolia.mn";
const HOME = ORIGIN + "/home";
const FOLDER = "Burduulelt";
// PDF iframe-д гарахгүй үед л дарж үзэх, зөвхөн татах үйлдэлтэй товчнууд.
// «Илгээх», «Төлөх», «Үргэлжлүүлэх» зэрэг хүсэлт илгээдэг товчийг санаатайгаар оруулаагүй.
// «Шинээр авах»-ыг зөвхөн «Тодруулга» (өмнө авсан) цонхонд, үнэгүй ба шууд гардаг үйлчилгээнд, тохиргоо зөвшөөрсөн үед дарна.
const FALLBACK = ["Татах", "Татаж авах", "PDF татах"];

let pendingName = null;

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (pendingName) {
    const date = new Date().toISOString().slice(0, 10);
    suggest({ filename: `${FOLDER}/${pendingName}_${date}.pdf`, conflictAction: "uniquify" });
  } else suggest();
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const safeName = s => s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_").slice(0, 80);

function waitForDownload(timeoutMs) {
  let cancel;
  const p = new Promise(resolve => {
    cancel = () => { cleanup(); resolve(null); };
    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    function onChanged(d) {
      if (d.state?.current === "complete") { cleanup(); resolve(d.id); }
      if (d.state?.current === "interrupted") { cleanup(); resolve(null); }
    }
    function onTab(tabId, info, tab) {
      // PDF шинэ таб дээр нээгдвэл татаж аваад табыг хаана
      if (info.status === "complete" && /\.pdf($|\?)/i.test(tab.url || "")) {
        chrome.downloads.download({ url: tab.url });
        chrome.tabs.remove(tabId);
      }
    }
    function cleanup() {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      chrome.tabs.onUpdated.removeListener(onTab);
    }
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.tabs.onUpdated.addListener(onTab);
  });
  p.cancel = cancel;
  return p;
}

async function getEmTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url?.includes("e-mongolia.mn")) return active;
  const [any] = await chrome.tabs.query({ url: "https://*.e-mongolia.mn/*" });
  return any || chrome.tabs.create({ url: HOME });
}

async function send(tabId, msg) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  return chrome.tabs.sendMessage(tabId, msg);
}

async function waitLoaded(tabId) {
  await sleep(500);
  for (let i = 0; i < 40; i++) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === "complete") break;
    await sleep(250);
  }
  await sleep(1500); // SPA рендер
}

// Нэг мөрийг: үйлчилгээний хуудас (каталогоос олсон path) → «Үйлчилгээ авах» → PDF
async function collect(item, index) {
  const tab = await getEmTab();
  await chrome.tabs.update(tab.id, { url: ORIGIN + item.path, active: true });
  await waitLoaded(tab.id);

  if (!(await send(tab.id, { type: "CHECK_LOGIN" }))?.loggedIn) return { ok: false, error: "NOT_LOGGED_IN" };

  const meta = await send(tab.id, { type: "SERVICE_META" });
  const url = (await chrome.tabs.get(tab.id)).url;
  if (!meta?.hasGetButton) return { ok: false, error: "«Үйлчилгээ авах» товч олдсонгүй", url };
  // Аюулгүй байдал: төлбөртэй эсвэл шууд гардаггүй үйлчилгээг автоматаар эхлүүлэхгүй
  if (meta.fee && !/үнэгүй/.test(meta.fee)) return { ok: false, error: "PAID", url };
  if (meta.duration && !/шууд/.test(meta.duration)) return { ok: false, error: "NOT_INSTANT", url };

  pendingName = `${String(index + 1).padStart(2, "0")}_${safeName(item.title)}`;
  const dl = waitForDownload(60000);
  try {
    return await getPdf(tab.id, dl);
  } finally {
    dl.cancel();
    pendingName = null;
  }
}

// «Үйлчилгээ авах» дарснаас хойш PDF гарах хүртэл хүлээнэ.
// Шууд гардаг лавлагаа /service/{id}/apply хуудсанд blob: iframe дотор PDF-ээр гарна. Үүнийг уншиж хадгална.
async function getPdf(tabId, dl) {
  const clicked = await send(tabId, { type: "CLICK", label: "Үйлчилгээ авах", exact: true });
  if (!clicked?.ok) return { ok: false, error: "«Үйлчилгээ авах» товч олдсонгүй", url: (await chrome.tabs.get(tabId)).url };

  const t0 = Date.now();
  const { onRepeat = "new" } = await chrome.storage.local.get("onRepeat");
  let fellBack = false, renewed = false, last = null;
  while (Date.now() - t0 < 45000) {
    const id = await Promise.race([dl, sleep(1500).then(() => null)]);
    if (id) return { ok: true, downloadId: id };

    last = await send(tabId, { type: "PROBE" }).catch(() => null); // хуудас ачаалж байвал дараагийн удаа
    if (!last) continue;
    if (last.pdf) {
      const r = await send(tabId, { type: "READ_PDF", src: last.pdf });
      if (!r?.ok) return { ok: false, error: r?.error || "PDF уншиж чадсангүй", url: last.url };
      await chrome.downloads.download({ url: r.dataUrl });
      const id = await dl;
      return id ? { ok: true, downloadId: id } : { ok: false, error: "PDF хадгалж чадсангүй", url: last.url };
    }
    if (last.login) return { ok: false, error: "NOT_LOGGED_IN", url: last.url };
    if (last.confirm) {
      const c = last.confirm;
      // «Та энэ үйлчилгээг N цагийн өмнө авсан байна» → «Шинээр авах» дарж шинэ PDF авна
      if (c.buttons.includes("шинээр авах")) {
        if (renewed) continue; // цонх хаагдаж байна
        if (onRepeat !== "new") return { ok: false, error: "REPEAT", url: last.url };
        renewed = true;
        await send(tabId, { type: "CONFIRM_CLICK", label: "Шинээр авах" });
        continue;
      }
      return { ok: false, error: "e-Mongolia: " + c.content.slice(0, 200), url: last.url };
    }
    if (last.needsInput && Date.now() - t0 > 8000) return { ok: false, error: "NEEDS_INPUT", url: last.url };
    if (!fellBack && Date.now() - t0 > 15000) {
      fellBack = true;
      await send(tabId, { type: "TRY_FALLBACK", labels: FALLBACK }).catch(() => {});
    }
  }
  return { ok: false, error: last?.success ? "Амжилттай гэсэн ч PDF олдсонгүй" : "PDF татагдсангүй", url: last?.url || (await chrome.tabs.get(tabId)).url };
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  (async () => {
    if (msg.type === "COLLECT") reply(await collect(msg.item, msg.index));
    else if (msg.type === "OPEN_FILE") { chrome.downloads.open(msg.id); reply({}); }
    else if (msg.type === "SHOW_FILE") { chrome.downloads.show(msg.id); reply({}); }
    else if (msg.type === "OPEN_EM") { const t = await getEmTab(); chrome.tabs.update(t.id, { active: true }); reply({}); }
    else if (msg.type === "OPEN_URL") { chrome.tabs.create({ url: msg.url }); reply({}); }
  })();
  return true;
});
