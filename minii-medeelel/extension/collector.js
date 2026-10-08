// Бичиг баримт цуглуулах (Бүрдүүлэлт AI-аас шилжүүлсэн, ../../extension/content.js):
// e-Mongolia-ийн үйлчилгээний хуудсан дээр нэвтэрсэн эсэх, хугацаа/төлбөр унших, товч дарах, PDF барих.
// Хуудасны хувийн мэдээллийг хаашаа ч илгээхгүй. PDF зөвхөн хэрэглэгчийн өөрийн Downloads руу очно.
(() => {
  if (window.__miniiCollector) return;
  window.__miniiCollector = true;
  const TYPES = new Set(["CHECK_LOGIN", "SERVICE_META", "CLICK", "CONFIRM_CLICK", "PROBE", "READ_PDF", "TRY_FALLBACK", "FILL_FORM"]);

  const norm = s => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Цэсэнд мөн «Үйлчилгээ авах» нэртэй (/service руу хөтөлдөг) товч байдаг. Өргөн дэлгэц дээр харагдаж,
  // DOM-д жинхэнэ товчноос өмнө ирдэг тул цэс, толгой хэсгийн элементийг алгасна.
  const inNav = el => !!el.closest("nav, aside, header, [role=navigation], [role=menu]");

  async function waitFor(fn, ms = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(300); }
    return null;
  }

  function findButton(label, exact = false) {
    const want = norm(label);
    const els = [...document.querySelectorAll("button, a, [role=button]")].filter(el => visible(el) && !el.disabled && !inNav(el));
    return els.find(el => norm(el.innerText) === want) || (!exact && els.find(el => norm(el.innerText).includes(want)));
  }

  // Хуудсан дээрх нээлттэй цонхнууд. «Видео заавар» нь хуудас ачаалахад автоматаар нээгддэг тул тусад нь ялгана.
  const openModals = () => [...document.querySelectorAll(".ant-modal, [role=dialog]")].filter(visible);
  const isVideo = m => /^\s*видео заавар/i.test(m.innerText) || !!m.querySelector("video, iframe[src*='youtube']");
  const isLogin = m => /нэвтрэх/i.test(m.innerText) && /дан/i.test(m.innerText);
  // «Тодруулга» / «Анхааруулга» зэрэг modal.confirm цонх (класс нэрээс хамаарахгүйгээр олно)
  const confirmModal = () => openModals().filter(m => !isVideo(m) && !isLogin(m) && m.querySelector("button")).pop();

  function closeVideo() {
    for (const m of openModals().filter(isVideo)) m.querySelector(".ant-modal-close, button[aria-label=Close]")?.click();
  }

  function loggedIn() {
    // Нэвтэрсэн үед auth-token cookie болон толгой хэсэгт «Нүүр зураг» аватар байдаг
    return /(?:^|;\s*)auth-token=/.test(document.cookie) || !!document.querySelector('img[alt="Нүүр зураг"]');
  }

  function readServiceMeta() {
    // Үйлчилгээний хуудасны «Хугацаа: Шууд», «Төлбөр: Үнэгүй» хэсгийг уншина
    const body = norm(document.body.innerText);
    const grab = key => { const m = body.match(new RegExp(key + "\\s+([^\\s]+)")); return m ? m[1] : null; };
    return { duration: grab("хугацаа"), fee: grab("төлбөр"), hasGetButton: !!findButton("Үйлчилгээ авах", true) };
  }

  // «Үйлчилгээ авах»-ын дараах төлөв. Шууд гардаг лавлагааны үр дүн /apply хуудсанд
  // blob: хаягтай iframe дотор PDF-ээр харагддаг (татах товч, татах үйлдэл байхгүй).
  function probe() {
    const frame = [...document.querySelectorAll("iframe, embed, object")]
      .find(f => /^blob:|\.pdf($|\?)/i.test(f.src || f.data || ""));
    const confirm = confirmModal();
    const login = openModals().some(isLogin);
    const main = document.querySelector("main") || document.body;
    const fields = [...main.querySelectorAll("input, select, textarea")]
      .filter(i => visible(i) && !inNav(i) && i.type !== "hidden" && !/хайх/i.test(i.placeholder || ""));
    return {
      url: location.href,
      pdf: frame ? (frame.src || frame.data) : null,
      confirm: confirm ? {
        title: norm(confirm.querySelector(".ant-modal-confirm-title, .ant-modal-title")?.innerText || confirm.innerText.trim().split("\n")[0]),
        content: (confirm.querySelector(".ant-modal-confirm-content")?.innerText || confirm.innerText).replace(/\s+/g, " ").trim().slice(0, 300),
        buttons: [...confirm.querySelectorAll("button")].map(b => norm(b.innerText)).filter(Boolean),
      } : null,
      login,
      success: /амжилттай/i.test(main.innerText),
      needsInput: /\/apply/.test(location.pathname) && fields.length > 0,
    };
  }

  // Хуудсан дээрх blob PDF-ийг data URL болгож background руу дамжуулна (background нь blob-д хандаж чадахгүй)
  async function readPdf(src) {
    const blob = await (await fetch(src)).blob();
    const head = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
    if (head !== "%PDF-") return { ok: false, error: "PDF биш файл: " + blob.type };
    const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    return { ok: true, dataUrl: dataUrl.replace(/^data:[^;]*;/, "data:application/pdf;"), size: blob.size };
  }

  // --- /apply маягт бөглөх (Ant Design Form) ---
  // Шошгоор нь танина: «Эхлэх он» / «Дуусах он» → визийн шаардлагаас тооцсон он, «Хаана зориулж» → addressee.
  // Танихгүй шаардлагатай талбарыг бөглөхгүй — тэр үед хэрэглэгч өөрөө бөглөнө.
  const RULES = [
    { re: /эхлэх\s*(он|огноо)|(^|\s)оноос/, key: "startYear" }, // кирилл үсэгт \b ажилладаггүй
    { re: /дуусах\s*(он|огноо)|он\s*хүртэл/, key: "endYear" },
    { re: /хаана\s*зориулж|хаана\s*(өгөх|ашиглах)|зориулалт|хаашаа/, key: "addressee" },
  ];

  function setValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value); // React-ийн удирддаг талбарт утга оноох
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  async function fillForm(fill) {
    const main = document.querySelector("main") || document.body;
    const items = [...main.querySelectorAll(".ant-form-item")].filter(visible);
    const filled = [], missing = [], seen = [];
    for (const it of items) {
      const label = norm(it.querySelector(".ant-form-item-label")?.innerText).replace(/[:*]/g, "").trim();
      const required = !!it.querySelector(".ant-form-item-required");
      const el = it.querySelector("textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio])");
      const kind = it.querySelector(".ant-select") ? "select" : it.querySelector(".ant-picker") ? "date" : el ? el.tagName.toLowerCase() : "other";
      seen.push(`${label || "?"}(${kind}${required ? ",*" : ""})`);
      if (el && el.value && !/^\s*$/.test(el.value)) continue; // аль хэдийн бөглөгдсөн
      const rule = RULES.find(r => r.re.test(label));
      const value = rule && fill?.[rule.key];
      if (el && (kind === "input" || kind === "textarea") && value) { setValue(el, String(value)); filled.push(label); }
      else if (required) missing.push(label || "нэргүй талбар");
    }
    await sleep(400);
    const errors = [...main.querySelectorAll(".ant-form-item-explain-error")].filter(visible).map(e => e.innerText.trim()).filter(Boolean);
    return { filled, missing, errors, seen, hasForm: items.length > 0 };
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (!TYPES.has(msg.type)) return; // content.js-ийн мессежийг (COLLECT) таслахгүй
    (async () => {
      switch (msg.type) {
        case "CHECK_LOGIN":
          return reply({ loggedIn: loggedIn() });

        case "SERVICE_META": {
          await waitFor(() => findButton("Үйлчилгээ авах", true), 8000);
          return reply(readServiceMeta());
        }

        case "CLICK": {
          closeVideo();
          await sleep(300);
          const btn = await waitFor(() => findButton(msg.label, msg.exact), msg.timeout || 8000);
          if (!btn) return reply({ ok: false });
          btn.scrollIntoView({ block: "center" });
          btn.click();
          return reply({ ok: true });
        }

        case "CONFIRM_CLICK": {
          const confirm = confirmModal();
          const btn = confirm && [...confirm.querySelectorAll("button")].find(b => norm(b.innerText) === norm(msg.label));
          if (!btn) return reply({ ok: false });
          btn.click();
          return reply({ ok: true });
        }

        case "PROBE":
          return reply(probe());

        case "READ_PDF":
          try { return reply(await readPdf(msg.src)); } catch (e) { return reply({ ok: false, error: String(e) }); }

        case "FILL_FORM":
          return reply(await fillForm(msg.fill));

        case "TRY_FALLBACK": {
          for (const label of msg.labels) {
            const btn = findButton(label, true);
            if (btn) { btn.click(); return reply({ clicked: label }); }
          }
          return reply({ clicked: null });
        }
      }
    })();
    return true;
  });
})();
