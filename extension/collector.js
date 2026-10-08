// Бичиг баримт цуглуулах: e-Mongolia-ийн үйлчилгээний хуудсан дээр нэвтэрсэн эсэх, хугацаа/төлбөр унших, товч дарах, PDF барих.
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
  // 2026-10-08-нд 12 лавлагаан дээр туршсан. Талбарыг шошгоор нь танина:
  //   «Эхлэх он» / «Дуусах он» → визийн/зорилгын шаардлагаас тооцсон он (НДШ)
  //   «Хаана зориулж»          → addressee, ирээгүй бол маягтын «Жишээ нь: …» текст
  //   «Ү дугаар»                → ХУР-аас хэрэглэгчийн үл хөдлөх хөрөнгийн дугаар (ганц хөрөнгөтэй бол)
  //   radio («Хэнд», хүн сонгох) → ганц сонголт, эсвэл «Өөртөө» / «Хүүхдийн»-ийг subject-ээр
  //   «Хэл сонгох» (гадаад хэлээр лавлагаа; select, radio эсвэл checkbox) → AI-ийн сонгосон хэл, байхгүй бол англи
  // Танихгүй шаардлагатай талбарыг бөглөхгүй — тэр үед хэрэглэгч өөрөө бөглөнө.
  const RULES = [
    { re: /эхлэх\s*(он|огноо)|(^|\s)оноос/, key: "startYear" }, // кирилл үсэгт \b ажилладаггүй
    { re: /дуусах\s*(он|огноо)|он\s*хүртэл/, key: "endYear" },
    { re: /хаана\s*зориулж|хаана\s*(өгөх|ашиглах)|зориулалт|хаашаа/, key: "addressee" },
    { re: /(^|\s)ү\s*дугаар|үл\s*хөдлөх.*дугаар/, key: "propertyNumber" },
    { re: /хүүхдийн\s*регистр/, key: "childRegnum" },
  ];
  const SELF = /өөрт|өөрий|өөрөө/, CHILD = /хүүхд/;

  // Гадаад хэлээр лавлагааны хэл: fill.language (жишээ нь «англи») → маягтын сонголтын текст
  const LANGS = {
    англи: /англи|english|(^|[^a-z])eng([^a-z]|$)/i, орос: /орос|russian|русск/i, хятад: /хятад|chinese|中文/i,
    япон: /япон|japanese|日本/i, солонгос: /солонгос|korean|한국/i, герман: /герман|german|deutsch/i, франц: /франц|french|français/i,
  };
  const LANG_LABEL = /(^|\s)хэл(\s|$)|хэлээр|хэлний|language/; // «хэлбэр»-ийг оруулахгүй
  const isLang = t => Object.values(LANGS).some(re => re.test(t));
  // Хүссэн хэл → англи → ганц сонголт. Олдохгүй бол -1 (хэрэглэгч өөрөө сонгоно)
  function pickLang(texts, want) {
    const key = Object.keys(LANGS).find(k => norm(want).includes(k));
    for (const re of [LANGS[key], LANGS.англи].filter(Boolean)) {
      const i = texts.findIndex(t => re.test(t));
      if (i >= 0) return i;
    }
    return texts.length === 1 ? 0 : -1;
  }
  // Бөглөж чадаагүй сонголтын талбар: сонголтуудыг нь хамт харуулна (юу сонгохыг хэрэглэгч, хөгжүүлэгч харна)
  const choiceLabel = (label, texts) => texts.length ? `${label} (${texts.slice(0, 6).join(", ")})` : label;

  // Ant Design Select: mousedown-оор нээгээд (onClick-оор) сонголтыг дарна. Dropdown нь body-д тусдаа зурагддаг.
  async function chooseSelect(it, want) {
    const box = it.querySelector(".ant-select-selector");
    if (!box) return { ok: false, options: [] };
    box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    const dd = await waitFor(() => [...document.querySelectorAll(".ant-select-dropdown")]
      .find(d => visible(d) && !d.classList.contains("ant-select-dropdown-hidden")), 3000);
    if (!dd) return { ok: false, options: [] };
    await sleep(300);
    const opts = [...dd.querySelectorAll(".ant-select-item-option:not(.ant-select-item-option-disabled)")];
    const texts = opts.map(o => norm(o.getAttribute("title") || o.innerText));
    const i = pickLang(texts, want);
    if (i < 0) { box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); return { ok: false, options: texts }; }
    opts[i].click();
    await sleep(400);
    if (it.querySelector(".ant-select-multiple")) document.activeElement?.blur?.(); // олон сонголттой бол цонхыг хаана
    return { ok: !!it.querySelector(".ant-select-selection-item"), options: texts };
  }

  function setValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value); // React-ийн удирддаг талбарт утга оноох
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // Маягтын «Жишээ нь: …» текст
  const example = it => (it.querySelector(".ant-form-item-extra")?.innerText.match(/жишээ нь:\s*(.+)$/im) || [])[1]?.trim() || null;

  // ХУР-аас хэрэглэгчийн өөрийн мэдээлэл (хуудсанд л ашиглана, хаашаа ч илгээхгүй)
  async function xypList(serviceCode) {
    const token = decodeURIComponent(document.cookie.match(/(?:^|;\s*)auth-token=([^;]+)/)?.[1] || "");
    try {
      const j = await (await fetch("/api/routes/xyp", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": "mn", "X-Auth-Token": token },
        body: JSON.stringify({ target: "xyp-data", params: { serviceCode, sid: null } }),
      })).json();
      const d = j?.data || {};
      return d.listData || d.list || d.children || (Array.isArray(d) ? d : []);
    } catch { return []; }
  }
  // Үл хөдлөх хөрөнгийн улсын бүртгэлийн дугаар. Утгыг өөрчлөхгүй (кирилл «у»-тай нь маягт хүлээж авдаг — туршсан).
  // Олон хөрөнгөтэй бол аль нь болохыг хэрэглэгч сонгоно.
  async function propertyNumber() {
    const list = await xypList("WS100202_getPropertyList");
    return list.length === 1 ? String(list[0].propertyNationRegisterNumber || "") || null : null;
  }
  // Хүүхдийн регистрийн дугаар: яг нэг хүүхэдтэй үед л. (Туршсан бүртгэлд хүүхэд бүртгэлгүй байсан тул талбарын нэрийг
  // ХУР-ын түгээмэл нэршлээр таамагласан — олдохгүй бол хэрэглэгч өөрөө бөглөнө.)
  async function childRegnum() {
    const list = await xypList("WS100120_childrenInfo");
    const v = list.length === 1 && (list[0].regnum || list[0].registerNumber || list[0].childRegnum);
    return v ? String(v) : null;
  }

  function pickRadio(opts, subject) {
    if (opts.length === 1) return opts[0];
    const hits = opts.filter(o => (subject === "child" ? CHILD : SELF).test(norm(o.innerText)));
    return hits.length === 1 ? hits[0] : null;
  }

  async function fillForm(fill = {}) {
    const main = document.querySelector("main") || document.body;
    const filled = [], missing = [], seen = [];
    const labelOf = el => norm(el?.querySelector(".ant-form-item-label")?.innerText).replace(/[:*]/g, "").trim();

    for (const g of [...main.querySelectorAll(".ant-radio-group, .ant-checkbox-group")].filter(visible)) {
      const radio = g.matches(".ant-radio-group");
      const item = g.closest(".ant-form-item");
      const label = labelOf(item) || "сонголт";
      seen.push(`${label}(${radio ? "radio" : "checkbox"})`);
      if (g.querySelector(".ant-radio-wrapper-checked, .ant-checkbox-wrapper-checked")) continue;
      const opts = [...g.querySelectorAll(".ant-radio-wrapper, .ant-checkbox-wrapper")].filter(visible);
      const texts = opts.map(o => norm(o.innerText));
      const opt = LANG_LABEL.test(label) || texts.filter(isLang).length >= 2 ? opts[pickLang(texts, fill.language)]
        : radio ? pickRadio(opts, fill.subject) : null;
      if (opt) { opt.click(); filled.push(label); await sleep(500); }
      else if (radio || item?.querySelector(".ant-form-item-required")) missing.push(choiceLabel(label, texts));
    }

    const items = [...main.querySelectorAll(".ant-form-item")].filter(visible);
    for (const it of items) {
      if (it.querySelector(".ant-radio-group, .ant-checkbox-group")) continue; // дээр сонгосон
      const label = labelOf(it);
      const required = !!it.querySelector(".ant-form-item-required");
      const el = it.querySelector("textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio])");
      const native = it.querySelector("select");
      const kind = it.querySelector(".ant-select") ? "select" : it.querySelector(".ant-picker") ? "date" : native ? "native-select" : el ? el.tagName.toLowerCase() : "other";
      seen.push(`${label || "?"}(${kind}${required ? ",*" : ""})`);
      if (kind === "select" || kind === "native-select") {
        // Сонголтын талбар: зөвхөн «Хэл сонгох»-ыг бөглөнө, бусдыг хэрэглэгч сонгоно
        if (kind === "select" ? it.querySelector(".ant-select-selection-item") : native.value) continue; // аль хэдийн сонгогдсон
        if (!LANG_LABEL.test(label)) { if (required) missing.push(label || "нэргүй талбар"); continue; }
        let r;
        if (kind === "select") r = await chooseSelect(it, fill.language);
        else {
          const texts = [...native.options].map(o => norm(o.text));
          const i = pickLang(texts, fill.language);
          if (i >= 0) { native.selectedIndex = i; native.dispatchEvent(new Event("change", { bubbles: true })); }
          r = { ok: i >= 0, options: texts };
        }
        if (r.ok) filled.push(label);
        else missing.push(choiceLabel(label, r.options));
        continue;
      }
      if (el && el.value && !/^\s*$/.test(el.value)) continue; // аль хэдийн бөглөгдсөн
      const rule = RULES.find(r => r.re.test(label));
      let value = rule && fill[rule.key];
      if (rule?.key === "addressee" && !value) value = example(it);
      if (rule?.key === "propertyNumber" && !value) value = await propertyNumber();
      if (rule?.key === "childRegnum" && !value) value = await childRegnum();
      if (el && (kind === "input" || kind === "textarea") && value) { setValue(el, String(value)); filled.push(label); }
      else if (required) missing.push(label || "нэргүй талбар");
    }
    await sleep(400);
    const errors = [...main.querySelectorAll(".ant-form-item-explain-error")].filter(visible).map(e => e.innerText.trim()).filter(Boolean);
    return { filled, missing, errors, seen, hasForm: seen.length > 0 };
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
