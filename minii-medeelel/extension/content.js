// Нэвтэрсэн e-Mongolia таб дээр ажиллана. Сайт өөрөө хэрэглэдэг /api/routes/xyp-ийг
// хэрэглэгчийн өөрийн token-оор дуудаж, хариуг зөвхөн extension руу (локал) буцаана.
(() => {
  if (window.__miniiMedeelel) return;
  window.__miniiMedeelel = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const token = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)auth-token=([^;]+)/)?.[1] || "");

  async function xyp(serviceCode, params = {}) {
    const r = await fetch("/api/routes/xyp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": "mn", "X-Auth-Token": token() },
      body: JSON.stringify({ target: "xyp-data", params: { serviceCode, sid: null, ...params } }),
    });
    if (r.status === 401) return { ok: false, error: "NOT_LOGGED_IN" };
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, error: `HTTP ${r.status}` };
    // Хариуны бүтэц: { result, resultCode, requestId, data, ... }
    if (!j.result) return { ok: false, error: j.message || j.error || `resultCode ${j.resultCode ?? "?"}`, keys: Object.keys(j) };
    return { ok: true, data: j.data ?? null, resultCode: j.resultCode };
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type !== "COLLECT") return;
    (async () => {
      if (!token()) return reply({ error: "NOT_LOGGED_IN" });
      const results = {};
      for (const s of msg.sources) {
        try { results[s.id] = await xyp(s.serviceCode, s.params); }
        catch (e) { results[s.id] = { ok: false, error: String(e) }; }
        if (results[s.id].error === "NOT_LOGGED_IN") return reply({ error: "NOT_LOGGED_IN" });
        await sleep(300); // сайтыг ачааллахгүйн тулд
      }
      reply({ results });
    })();
    return true;
  });
})();
