/* Servidor simulado para as demonstrações. Site e painel partilham os mesmos dados (localStorage) no mesmo navegador. */
(function () {
  const CFG = __CONFIG__;
  const MODE = "__MODE__"; // "cliente" | "admin"

  /* ---- dados de exemplo só para a demonstração (não são da barbearia) ---- */
  Object.assign(CFG, {
    phone: "+351 912 345 678", whatsapp: "351912345678",
    instagram: "https://www.instagram.com/", facebook: "https://www.facebook.com/",
    team: [{ name: "Barbeiro 1", role: "Barbeiro" }, { name: "Barbeiro 2", role: "Barbeiro" }, { name: "Aprendiz", role: "Em formação" }],
  });
  const ICON = {
    scissors: '<circle cx="9" cy="9" r="4"/><circle cx="9" cy="23" r="4"/><path d="M12 11l14 12M12 21L26 9" stroke-width="2.6" fill="none"/>',
    razor: '<rect x="6" y="14" width="22" height="7" rx="2"/><path d="M28 17h9v3h-9z"/><path d="M8 14l3-5h14l3 5" fill="none" stroke-width="2.4"/>',
    comb: '<rect x="4" y="10" width="34" height="8" rx="2"/><path d="M8 18v10M14 18v10M20 18v10M26 18v10M32 18v10" stroke-width="2.6"/>',
    brush: '<rect x="14" y="4" width="14" height="14" rx="5"/><rect x="18" y="18" width="6" height="20" rx="3"/>',
    drop: '<path d="M21 4C21 4 8 18 8 27a13 13 0 0 0 26 0C34 18 21 4 21 4z"/>',
    pole: '<rect x="14" y="8" width="14" height="30" rx="5" fill="none" stroke-width="2.6"/><path d="M14 16l14-6M14 25l14-6M14 34l14-6" stroke-width="2.6"/>',
  };
  function tile(bg, fg, icon) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="${bg}"/>` +
      `<g transform="translate(100 100) scale(5)" fill="${fg}" stroke="${fg}" stroke-width="0">${ICON[icon]}</g></svg>`;
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }
  CFG.gallery = [
    { src: tile("#12303F", "#8FD3E6", "scissors"), alt: "Foto de exemplo: tesoura", caption: "Corte à tesoura" },
    { src: tile("#C8382B", "#FFFFFF", "razor"), alt: "Foto de exemplo: navalha", caption: "Barba à navalha" },
    { src: tile("#1B6580", "#EEF5F6", "comb"), alt: "Foto de exemplo: pente", caption: "Degradê" },
    { src: tile("#C79A3B", "#1B1405", "brush"), alt: "Foto de exemplo: pincel", caption: "Toalha quente" },
    { src: tile("#0B1F2A", "#EEF5F6", "drop"), alt: "Foto de exemplo: gota", caption: "Acabamento" },
    { src: tile("#DCE9EC", "#C8382B", "pole"), alt: "Foto de exemplo: poste de barbeiro", caption: "A nossa casa" },
  ];

  /* ---- utilitários ---- */
  const KEY = "apb-demo-v3", BKEY = "apb-demo-blocks-v3"; let mem = null, memB = null;
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const pad = (n) => String(n).padStart(2, "0");
  const fromMin = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const weekday = (ds) => new Date(ds + "T00:00:00Z").getUTCDay();
  const addDays = (ds, n) => { const d = new Date(ds + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const now = () => { const d = new Date(); return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, minutes: d.getHours() * 60 + d.getMinutes() }; };
  const rid = () => "APB-" + Math.random().toString(16).slice(2, 8).toUpperCase();
  const SVC = (id) => CFG.services.find((s) => s.id === id);

  /* ---- histórico de exemplo: ~5 semanas para trás e 2 para a frente ---- */
  const CLIENTS = [
    ["Ricardo Silva", "912000101"], ["Tiago Costa", "934000202"], ["Miguel Santos", "965000303"], ["André Ferreira", "912000404"],
    ["Pedro Almeida", "936000505"], ["João Martins", "963000606"], ["Diogo Rocha", "912000707"], ["Rui Pereira", "934000808"],
    ["Bruno Carvalho", "965000909"], ["Hugo Lopes", "912001010"], ["Nuno Fernandes", "936001111"], ["Filipe Gomes", "963001212"],
  ];
  function rng(seed) {
    let h = 2166136261; for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function seed() {
    const n = now(), out = [];
    for (let i = -35; i <= 14; i++) {
      const day = addDays(n.date, i), hrs = CFG.hours[String(weekday(day))]; if (!hrs) continue;
      const r = rng(day); let m = toMin(hrs[0]) + (r() < 0.5 ? 0 : 30);
      const brk = CFG.breakTime ? [toMin(CFG.breakTime[0]), toMin(CFG.breakTime[1])] : null;
      let count = 0; const maxN = i < 0 ? 7 : i === 0 ? 6 : 5;
      while (m < toMin(hrs[1]) - 30 && count < maxN) {
        const sv = CFG.services[Math.floor(r() * CFG.services.length)];
        if (brk && m < brk[1] && m + sv.minutes > brk[0]) { m = brk[1]; continue; }
        if (m + sv.minutes > toMin(hrs[1])) break;
        if (r() < 0.78) {
          const c = CLIENTS[Math.floor(r() * CLIENTS.length)], mode = r() < 0.4 ? "now" : "later", x = r();
          let status;
          if (i < 0 || (i === 0 && m + sv.minutes <= n.minutes)) status = x < 0.84 ? "concluida" : x < 0.92 ? "faltou" : "cancelada";
          else if (mode === "now") status = x < 0.9 ? "paga" : "a_aguardar_pagamento";
          else status = x < 0.93 ? "confirmada" : "cancelada";
          out.push({ id: rid(), token: "x", day, time: fromMin(m), minutes: sv.minutes, service: sv.name, priceCents: sv.priceCents, name: c[0], phone: c[1], email: "", payMode: status === "confirmada" ? "later" : mode, status });
          count++;
        }
        m += sv.minutes + (r() < 0.5 ? 0 : 30);
      }
    }
    return out;
  }
  function load() {
    try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch {}
    if (mem) return mem;
    const s = seed(); save(s); return s;
  }
  function save(l) { mem = l; try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {} }
  function loadB() {
    try { const s = localStorage.getItem(BKEY); if (s) return JSON.parse(s); } catch {}
    return memB || [];
  }
  function saveB(l) { memB = l; try { localStorage.setItem(BKEY, JSON.stringify(l)); } catch {} }
  function reset() { mem = null; memB = null; try { localStorage.removeItem(KEY); localStorage.removeItem(BKEY); } catch {} }

  const blocksOn = (day) => loadB().filter((b) => b.day === day);
  const dayErr = (day) => {
    const n = now();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return "Data inválida.";
    if (day < n.date) return "Esse dia já passou.";
    if (day > addDays(n.date, CFG.daysAhead)) return "Dia demasiado longe.";
    if (!CFG.hours[String(weekday(day))]) return "Fechado nesse dia.";
    if (blocksOn(day).some((b) => !b.from)) return "Fechado nesse dia.";
    return null;
  };
  function slotsFor(day, minutes) {
    if (dayErr(day)) return [];
    const [open, close] = CFG.hours[String(weekday(day))];
    const busy = load().filter((b) => b.day === day && b.status !== "cancelada").map((b) => [toMin(b.time), toMin(b.time) + b.minutes]);
    if (CFG.breakTime) busy.push([toMin(CFG.breakTime[0]), toMin(CFG.breakTime[1])]);
    blocksOn(day).forEach((b) => { if (b.from) busy.push([toMin(b.from), toMin(b.to)]); });
    const n = now(), out = [];
    for (let m = toMin(open); m + minutes <= toMin(close); m += CFG.slotMinutes) {
      let ok = !busy.some(([s, e]) => m < e && s < m + minutes);
      if (day === n.date && m < n.minutes + CFG.minLeadMinutes) ok = false;
      out.push({ time: fromMin(m), ok });
    }
    return out;
  }
  const pub = (b) => ({ id: b.id, day: b.day, time: b.time, minutes: b.minutes, service: b.service, priceCents: b.priceCents, name: b.name, payMode: b.payMode, status: b.status });
  const find = (id, token) => load().find((b) => b.id === id && b.token === token);

  function validate(body) {
    const svc = SVC(body.serviceId);
    const phone = String(body.phone || "").replace(/[\s.\-()]/g, ""), name = String(body.name || "").trim();
    if (!svc) return { error: [400, "Serviço inválido."] };
    const e = dayErr(body.day); if (e) return { error: [400, e] };
    if (name.length < 2) return { error: [400, "Indique o nome."] };
    if (!/^(\+351)?[239]\d{8}$/.test(phone)) return { error: [400, "Indique um telemóvel português com 9 dígitos."] };
    const slot = slotsFor(body.day, svc.minutes).find((s) => s.time === body.time);
    if (!slot || !slot.ok) return { error: [409, "Essa hora acabou de ser ocupada. Escolha outra."] };
    return { svc, phone, name };
  }

  function route(method, u, body) {
    const p = u.pathname;
    if (p === "/api/config") {
      const { name, tagline, address, mapsLink, phone, whatsapp, instagram, facebook, hours, breakTime, daysAhead, cancelHoursBefore, services, team, gallery } = CFG;
      const min = Math.min(...services.map((s) => s.minutes));
      const closedDays = [...new Set(loadB().filter((b) => !b.from && b.day >= now().date).map((b) => b.day))];
      return [200, { name, tagline, address, mapsLink, phone, whatsapp, instagram, facebook, hours, breakTime, daysAhead, cancelHoursBefore, services, team, gallery,
        today: now().date, onlinePayments: true, closedDays, todayFull: !slotsFor(now().date, min).some((s) => s.ok) }];
    }
    if (p === "/api/availability") {
      const svc = SVC(u.searchParams.get("service")), day = u.searchParams.get("day");
      if (!svc) return [400, { error: "Serviço inválido." }];
      const e = dayErr(day); if (e) return [400, { error: e }];
      return [200, { day, slots: slotsFor(day, svc.minutes) }];
    }
    if (p === "/api/bookings" && method === "POST") {
      const v = validate(body); if (v.error) return [v.error[0], { error: v.error[1] }];
      const payNow = body.payMode === "now";
      const b = { id: rid(), token: Math.random().toString(16).slice(2), day: body.day, time: body.time, minutes: v.svc.minutes, service: v.svc.name, priceCents: v.svc.priceCents,
        name: v.name, phone: v.phone, email: String(body.email || "").trim(), payMode: payNow ? "now" : "later", status: payNow ? "a_aguardar_pagamento" : "confirmada" };
      save([...load(), b]);
      // com "Pagar agora" o site abre a página de pagamento simulada (apbDemoCheckout), que marca a marcação como paga
      return [201, { booking: pub(b), token: b.token, ...(payNow ? { checkoutUrl: "demo://checkout" } : {}) }];
    }
    let m = p.match(/^\/api\/bookings\/([^/]+)$/);
    if (m && method === "GET") { const b = find(m[1], u.searchParams.get("token")); return b ? [200, { booking: pub(b) }] : [404, { error: "Marcação não encontrada." }]; }
    m = p.match(/^\/api\/bookings\/([^/]+)\/cancel$/);
    if (m && method === "POST") {
      const b = find(m[1], body.token); if (!b) return [404, { error: "Marcação não encontrada." }];
      if (b.status === "paga") return [409, { error: "Esta marcação já está paga. Para cancelar e receber o reembolso, contacte a barbearia." }];
      b.status = "cancelada"; save(load().map((x) => (x.id === b.id ? b : x))); return [200, { booking: pub(b) }];
    }

    /* ---- painel do administrador ---- */
    if (p === "/api/admin/bookings" && method === "GET") {
      const from = u.searchParams.get("from") || now().date, to = u.searchParams.get("to") || "9999-12-31";
      const rows = load().filter((b) => b.day >= from && b.day <= to).sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
      return [200, { bookings: rows.map((b) => ({ ...pub(b), phone: b.phone, email: b.email || "" })) }];
    }
    if (p === "/api/admin/bookings" && method === "POST") {
      const v = validate(body); if (v.error) return [v.error[0], { error: v.error[1] }];
      const b = { id: rid(), token: Math.random().toString(16).slice(2), day: body.day, time: body.time, minutes: v.svc.minutes, service: v.svc.name, priceCents: v.svc.priceCents,
        name: v.name, phone: v.phone, email: String(body.email || "").trim(), payMode: "later", status: body.paid ? "paga" : "confirmada" };
      save([...load(), b]); return [201, { booking: pub(b) }];
    }
    m = p.match(/^\/api\/admin\/bookings\/([^/]+)\/status$/);
    if (m && method === "POST") {
      if (!["confirmada", "paga", "cancelada", "concluida", "faltou"].includes(body.status)) return [400, { error: "Estado inválido." }];
      const l = load(), b = l.find((x) => x.id === m[1]); if (!b) return [404, { ok: false }];
      b.status = body.status; save(l); return [200, { ok: true }];
    }
    if (p === "/api/admin/blocks" && method === "GET") {
      const rows = loadB().filter((b) => b.day >= now().date).sort((a, b) => (a.day + (a.from || "")).localeCompare(b.day + (b.from || "")));
      return [200, { blocks: rows }];
    }
    if (p === "/api/admin/blocks" && method === "POST") {
      const day = body.day, from = body.from || null, to = body.to || null, reason = String(body.reason || "").slice(0, 80);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "") || day < now().date) return [400, { error: "Escolha um dia a partir de hoje." }];
      if (Boolean(from) !== Boolean(to)) return [400, { error: "Indique a hora de início e de fim." }];
      if (from && toMin(from) >= toMin(to)) return [400, { error: "A hora de fim tem de ser depois da de início." }];
      const blk = { id: "BLK-" + Math.random().toString(16).slice(2, 8).toUpperCase(), day, from, to, reason };
      saveB([...loadB(), blk]);
      const conflicts = load().filter((b) => b.day === day && b.status !== "cancelada" && (!from || (toMin(b.time) < toMin(to) && toMin(from) < toMin(b.time) + b.minutes))).length;
      return [201, { block: blk, conflicts }];
    }
    m = p.match(/^\/api\/admin\/blocks\/([^/]+)$/);
    if (m && method === "DELETE") { const l = loadB(), n = l.length; saveB(l.filter((b) => b.id !== m[1])); return [n !== loadB().length ? 200 : 404, { ok: n !== loadB().length }]; }
    return [404, { error: "Não encontrado." }];
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts = {}) => {
    const raw = typeof url === "string" ? url : (url && url.url) || String(url);
    // base fixa: funciona também em pré-visualizações (about:blank, srcdoc, blob), onde location.href não serve de base
    let u; try { u = new URL(raw, "http://demo.local/"); } catch { return realFetch(url, opts); }
    if (!u.pathname.startsWith("/api/") || (u.origin !== "http://demo.local" && !/^file:/.test(u.protocol))) return realFetch(url, opts);
    await new Promise((r) => setTimeout(r, 100));
    let body = {}; try { body = opts.body ? JSON.parse(opts.body) : {}; } catch {}
    const [status, data] = route((opts.method || "GET").toUpperCase(), u, body);
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  };

  /* ---- página de pagamento SIMULADA (só na demonstração; no site real é a página segura do Stripe) ---- */
  window.apbDemoCheckout = function (booking) {
    return new Promise((resolve) => {
      const full = load().find((x) => x.id === booking.id) || {};
      const eurFmt = (c) => (c / 100).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
      const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
      const field = (id, label, value, attrs) => {
        const w = el("div", "field"), l = el("label", "", label), i = el("input");
        l.htmlFor = id; i.id = id; i.value = value; Object.entries(attrs || {}).forEach(([k, v]) => i.setAttribute(k, v));
        w.append(l, i); return [w, i];
      };
      const option = (id, title, sub, checked) => {
        const w = el("div", "opt"), i = el("input"), l = el("label"), s = el("span");
        i.type = "radio"; i.name = "demo-method"; i.id = id; i.checked = checked; l.htmlFor = id;
        s.append(el("b", "", title), el("small", "", sub)); l.append(s); w.append(i, l); return [w, i];
      };

      const dlg = el("dialog"); dlg.setAttribute("aria-label", "Pagamento");
      const box = el("div", "dlg"), view = el("div"); box.append(view); dlg.append(box);
      let timer = null, done = false;
      const finish = (ok) => {
        if (done) return; done = true; clearTimeout(timer);
        const l = load(), x = l.find((b) => b.id === booking.id);
        if (x) { x.status = ok ? "paga" : "cancelada"; save(l); }
        if (dlg.open) dlg.close(); dlg.remove(); resolve(ok);
      };
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); });

      function wait(text, ms) {
        const cancel = el("button", "btn ghost", "Cancelar pagamento"); cancel.type = "button"; cancel.addEventListener("click", () => finish(false));
        const spin = el("div", "demo-spin"); spin.setAttribute("aria-hidden", "true");
        const msg = el("p", "", text); msg.setAttribute("role", "status");
        const row = el("div", "row"); row.append(cancel);
        view.replaceChildren(el("h3", "", "A aguardar pagamento"), spin, msg, row);
        timer = setTimeout(() => finish(true), ms);
      }

      function form() {
        const [mbOpt, mb] = option("pm-mb", "MB WAY", "Aprova o pagamento na app do telemóvel", true);
        const [cardOpt, card] = option("pm-card", "Cartão", "Visa ou Mastercard", false);
        const notice = el("p", "msg", "Simulação: não introduza dados reais. Nada é cobrado nem guardado.");
        const sum = el("p", "", `${booking.service} · ${booking.day.split("-").reverse().join("/")} às ${booking.time}`);
        const total = el("div", "demo-total"); total.append(el("span", "", "Total a pagar"), el("b", "", eurFmt(booking.priceCents)));

        const [mbF, phone] = field("pm-phone", "Telemóvel MB WAY", full.phone || "", { type: "tel", inputmode: "tel", autocomplete: "off", maxlength: "20" });
        const mbPanel = el("div", "demo-panel"); mbPanel.append(mbF);
        const [nF, num] = field("pm-num", "Número do cartão", "4242 4242 4242 4242", { inputmode: "numeric", autocomplete: "off", maxlength: "23" });
        const [eF, exp] = field("pm-exp", "Validade", "12/30", { autocomplete: "off", maxlength: "5", placeholder: "MM/AA" });
        const [cF, cvc] = field("pm-cvc", "CVC", "123", { inputmode: "numeric", autocomplete: "off", maxlength: "4" });
        const [hF] = field("pm-holder", "Nome no cartão", full.name || "", { autocomplete: "off", maxlength: "60" });
        const cardPanel = el("div", "demo-panel"); cardPanel.hidden = true;
        const two = el("div", "demo-two"); two.append(eF, cF); cardPanel.append(nF, two, hF);

        const err = el("div", "err"); err.setAttribute("role", "alert");
        const pay = el("button", "btn", `Pagar ${eurFmt(booking.priceCents)}`); pay.type = "button";
        const cancel = el("button", "btn ghost", "Cancelar"); cancel.type = "button";
        const row = el("div", "row"); row.append(pay, cancel);
        const opts = el("div", "opts"); opts.append(mbOpt, cardOpt);

        const sync = () => { mbPanel.hidden = !mb.checked; cardPanel.hidden = !card.checked; err.textContent = ""; };
        mb.addEventListener("change", sync); card.addEventListener("change", sync);
        cancel.addEventListener("click", () => finish(false));
        pay.addEventListener("click", () => {
          err.textContent = "";
          if (mb.checked) {
            const t = phone.value.replace(/[\s.\-()]/g, "");
            if (!/^(\+351)?9\d{8}$/.test(t)) { err.textContent = "Indique um número MB WAY válido (9 dígitos, a começar por 9)."; phone.focus(); return; }
            wait(`Pedido enviado para ${phone.value.trim()}. Aprove o pagamento na app MB WAY.`, 3200);
          } else {
            if (!/^\d{12,19}$/.test(num.value.replace(/\s/g, ""))) { err.textContent = "Número de cartão inválido."; num.focus(); return; }
            if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(exp.value.trim())) { err.textContent = "Validade inválida. Use MM/AA."; exp.focus(); return; }
            if (!/^\d{3,4}$/.test(cvc.value.trim())) { err.textContent = "CVC inválido."; cvc.focus(); return; }
            wait("A processar o pagamento…", 1400);
          }
        });
        view.replaceChildren(el("h3", "", "Pagamento"), notice, sum, total, el("p", "demo-lbl", "Método de pagamento"), opts, mbPanel, cardPanel, err, row);
      }

      form();
      document.body.append(dlg); dlg.showModal();
    });
  };

  /* ---- faixa de aviso ---- */
  const style = document.createElement("style");
  style.textContent = ".demo-site-dialog{}.demo-spin{width:34px;height:34px;margin:14px 0;border:4px solid var(--line,#CFDDE1);border-top-color:var(--tide,#1B6580);border-radius:50%;animation:demo-spin 1s linear infinite}@keyframes demo-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.demo-spin{animation:none}}.demo-total{display:flex;justify-content:space-between;align-items:baseline;font-size:1.3rem;padding:8px 0 14px;border-bottom:1px solid var(--line,#CFDDE1);margin-bottom:12px}.demo-lbl{font-weight:700;margin:4px 0 8px}.demo-panel{margin-top:14px}.demo-panel[hidden]{display:none}.demo-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}.demo-bar{background:#C79A3B;color:#1B1405;padding:8px 14px;font:600 .9rem system-ui,sans-serif;display:flex;gap:12px;justify-content:center;align-items:center;flex-wrap:wrap;text-align:center}.demo-bar button{font:inherit;background:transparent;border:1.5px solid #1B1405;color:#1B1405;border-radius:999px;padding:3px 12px;cursor:pointer}";
  if (MODE === "cliente") style.textContent += "dialog{max-height:calc(100dvh - 24px);overflow:auto}";
  document.head.append(style);
  const bar = document.createElement("div"); bar.className = "demo-bar";
  bar.append(document.createTextNode(MODE === "admin"
    ? "Painel de demonstração com dados de exemplo. Mostra as marcações do site de demonstração, neste navegador."
    : "Demonstração do site: nada é cobrado, as fotos e contactos são de exemplo e as marcações ficam só neste navegador."));
  const rb = document.createElement("button"); rb.type = "button"; rb.textContent = "Repor dados de exemplo";
  rb.addEventListener("click", () => { reset(); location.reload(); });
  bar.append(rb);
  document.addEventListener("DOMContentLoaded", () => document.body.prepend(bar));
})();
