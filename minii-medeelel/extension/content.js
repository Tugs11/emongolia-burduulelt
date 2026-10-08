// Нэвтэрсэн e-Mongolia таб дээр ажиллана. Сайт өөрөө хэрэглэдэг /api/routes/xyp-ийг
// хэрэглэгчийн өөрийн token-оор дуудаж, хариуг зөвхөн extension руу (локал) буцаана.
(() => {
  if (window.__miniiMedeelel) return;
  window.__miniiMedeelel = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const token = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)auth-token=([^;]+)/)?.[1] || "");

  async function xyp(serviceCode, customFields) {
    const r = await fetch("/api/routes/xyp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": "mn", "X-Auth-Token": token() },
      body: JSON.stringify({ target: "xyp-data", params: { serviceCode, sid: null, ...(customFields && { customFields }) } }),
    });
    if (r.status === 401) return { ok: false, error: "NOT_LOGGED_IN" };
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, error: `HTTP ${r.status}` };
    // Хариу: { result, resultCode, message, data, citizenData, … } — citizenData (хувийн мэдээлэл)-г авахгүй
    if (!j.result) return { ok: false, error: j.message || j.error || `resultCode ${j.resultCode ?? "?"}` };
    if (j.resultCode === 1) return { ok: true, data: null, note: j.message || "олдсонгүй" }; // мэдээлэл бүртгэлгүй
    return { ok: true, data: j.data ?? null };
  }

  // Машин бүрээр (улсын дугаар / арлын дугаар) дуудаж нэг жагсаалт болгоно
  async function perVehicle(s, vehicles) {
    const list = vehicles?.data?.list || [];
    if (!vehicles?.ok) return { ok: false, error: "Тээврийн хэрэгслийн жагсаалт татагдсангүй" };
    if (!list.length) return { ok: true, data: null, note: "тээврийн хэрэгсэл бүртгэлгүй" };
    const out = [];
    for (const v of list) {
      const r = await xyp(s.serviceCode, { [s.perVehicle.param]: v[s.perVehicle.field] });
      if (r.error === "NOT_LOGGED_IN") return r;
      out.push({ plateNumber: v.plateNumber, ...(r.ok ? { result: r.data, note: r.note } : { error: r.error }) });
      await sleep(300);
    }
    return { ok: true, data: { vehicles: out } };
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type !== "COLLECT") return;
    (async () => {
      if (!token()) return reply({ error: "NOT_LOGGED_IN" });
      const results = {};
      for (const s of msg.sources) {
        try {
          results[s.id] = s.perVehicle ? await perVehicle(s, results.vehicles) : await xyp(s.serviceCode, s.customFields);
        } catch (e) { results[s.id] = { ok: false, error: String(e) }; }
        if (results[s.id].error === "NOT_LOGGED_IN") return reply({ error: "NOT_LOGGED_IN" });
        await sleep(300); // сайтыг ачааллахгүйн тулд
      }
      reply({ results });
    })();
    return true;
  });
})();
