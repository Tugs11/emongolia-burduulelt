chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// --- Бичиг баримт цуглуулах: chat-ийн зорилго болон «Жагсаалтаар» табын жагсаалт хоёулаа үүнийг ашиглана ---
const ORIGIN = "https://e-mongolia.mn";
const HOME = ORIGIN + "/home";
const FOLDER = "Burduulelt";
// PDF iframe-д гарахгүй үед л дарж үзэх, зөвхөн татах үйлдэлтэй товчнууд.
// «Илгээх», «Төлөх», «Үргэлжлүүлэх» зэрэг хүсэлт илгээдэг товчийг санаатайгаар оруулаагүй.
// «Шинээр авах»-ыг зөвхөн «Тодруулга» (өмнө авсан) цонхонд, үнэгүй ба шууд гардаг үйлчилгээнд, тохиргоо зөвшөөрсөн үед дарна.
const FALLBACK = ["Татах", "Татаж авах", "PDF татах"];

let pendingName = null; // "<зорилго>/NN_нэр"

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
  await chrome.scripting.executeScript({ target: { tabId }, files: ["collector.js"] });
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

// Нэг бичиг баримт: үйлчилгээний хуудас (каталогоос олсон path) → «Үйлчилгээ авах» → PDF
// folder: Downloads/Burduulelt/<folder>/ (жишээ нь виз мэдүүлгийн зорилгоор)
async function collect(item, index, folder) {
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

  pendingName = `${folder ? safeName(folder) + "/" : ""}${String(index + 1).padStart(2, "0")}_${safeName(item.title)}`;
  // Маягтын утга: НДШ мэт хугацаатай лавлагаанд визийн шаардлагаас тооцсон он, «Хаана зориулж»-д хаана өгөх
  const y = new Date().getFullYear(), years = Math.min(10, Math.max(1, item.fill?.years || 1));
  const fill = { startYear: y - years, endYear: y, addressee: item.fill?.addressee || "", subject: item.fill?.subject || "self" };
  const dl = waitForDownload(90000);
  try {
    return await getPdf(tab.id, dl, fill);
  } finally {
    dl.cancel();
    pendingName = null;
  }
}

// «Үйлчилгээ авах» дарснаас хойш PDF гарах хүртэл хүлээнэ.
// Шууд гардаг лавлагаа /service/{id}/apply хуудсанд blob: iframe дотор PDF-ээр гарна. Үүнийг уншиж хадгална.
async function getPdf(tabId, dl, fill) {
  const clicked = await send(tabId, { type: "CLICK", label: "Үйлчилгээ авах", exact: true });
  if (!clicked?.ok) return { ok: false, error: "«Үйлчилгээ авах» товч олдсонгүй", url: (await chrome.tabs.get(tabId)).url };

  const t0 = Date.now();
  const onRepeat = "new"; // өмнө авсан бол «Шинээр авах» (зөвхөн үнэгүй, шууд гардаг үйлчилгээнд энд хүрнэ)
  let fellBack = false, renewed = false, formAt = 0, last = null;
  while (Date.now() - t0 < 70000) {
    const id = await Promise.race([dl, sleep(1500).then(() => null)]);
    if (id) return { ok: true, downloadId: id };

    last = await send(tabId, { type: "PROBE" }).catch(() => null); // хуудас ачаалж байвал дараагийн удаа
    if (!last) continue;
    if (last.pdf) {
      // PDF-ийг тусад нь хадгалахгүй — side panel бүгдийг нь нэг ZIP багц болгож нэг удаа татна
      const r = await send(tabId, { type: "READ_PDF", src: last.pdf });
      if (!r?.ok) return { ok: false, error: r?.error || "PDF уншиж чадсангүй", url: last.url };
      return { ok: true, dataUrl: r.dataUrl, size: r.size };
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
      // «Таны мэдээлэл бүртгэлгүй байна. Та мэдээлэл хариуцагч X-д хандана уу» — алдаа биш, тухайн бүртгэл байхгүй
      if (/бүртгэлгүй байна/i.test(c.content))
        return { ok: false, error: "NOT_REGISTERED", detail: (c.content.match(/хариуцагч\s+(.+?)-д\s+хандана/i) || [])[1] || "", url: last.url };
      return { ok: false, error: "e-Mongolia: " + c.content.slice(0, 200), url: last.url };
    }
    if (last.needsInput) {
      // /apply маягт: танигдах талбаруудыг бөглөөд «Үргэлжлүүлэх» дарна (энд зөвхөн үнэгүй, шууд гардаг үйлчилгээ хүрнэ)
      if (!formAt) {
        await sleep(1000); // талбарууд бүрэн зурагдахыг хүлээнэ
        // Сонголт хийсний дараа шинэ талбар гарч ирж болох тул (жишээ нь «Хүүхдийн» → хүүхэд сонгох) хэд хэдэн удаа бөглөнө
        let f = null, any = false;
        for (let round = 0; round < 4; round++) {
          f = await send(tabId, { type: "FILL_FORM", fill });
          if (!f?.filled?.length) break;
          any = true;
          await sleep(800);
        }
        if (!f || (!f.hasForm && !any) || f.missing.length || f.errors.length)
          return { ok: false, error: "NEEDS_INPUT", detail: f?.missing?.length ? "бөглөх: " + f.missing.join(", ") : (f?.errors || []).join("; "), url: last.url };
        const c = await send(tabId, { type: "CLICK", label: "Үргэлжлүүлэх", exact: true, timeout: 3000 });
        if (!c?.ok) return { ok: false, error: "NEEDS_INPUT", detail: "«Үргэлжлүүлэх» товч олдсонгүй", url: last.url };
        formAt = Date.now();
        continue;
      }
      if (Date.now() - formAt > 15000) return { ok: false, error: "NEEDS_INPUT", detail: "маягтыг бөглөсөн ч үргэлжлэхгүй байна", url: last.url };
      continue;
    }
    if (!fellBack && Date.now() - t0 > 15000) {
      fellBack = true;
      await send(tabId, { type: "TRY_FALLBACK", labels: FALLBACK }).catch(() => {});
    }
  }
  return { ok: false, error: last?.success ? "Амжилттай гэсэн ч PDF олдсонгүй" : "PDF татагдсангүй", url: last?.url || (await chrome.tabs.get(tabId)).url };
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "COLLECT_DOC") { collect(msg.item, msg.index, msg.folder).then(reply, e => reply({ ok: false, error: String(e) })); return true; }
  if (msg.type === "OPEN_FILE") { chrome.downloads.open(msg.id); reply({}); }
  if (msg.type === "SHOW_FILE") { chrome.downloads.show(msg.id); reply({}); }
  if (msg.type === "SHOW_FOLDER") { chrome.downloads.showDefaultFolder(); reply({}); }
});
