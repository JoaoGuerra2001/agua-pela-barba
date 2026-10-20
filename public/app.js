"use strict";
(async function () {
  const $ = (s) => document.querySelector(s);
  const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const WDL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const eur = (c) => (c / 100).toLocaleString("pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: c % 100 ? 2 : 0 });
  const weekday = (ds) => new Date(ds + "T00:00:00Z").getUTCDay();
  const addDays = (ds, n) => { const d = new Date(ds + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const longDay = (ds) => { const d = new Date(ds + "T00:00:00Z"); return `${WDL[d.getUTCDay()]}, ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`; };
  const pad2 = (n) => String(n).padStart(2, "0");
  const isHttps = (u) => typeof u === "string" && /^https:\/\//.test(u);

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v == null) continue;
      if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k);
    return e;
  }
  async function api(path, opts) {
    const r = await fetch(path, opts);
    let data = {};
    try { data = await r.json(); } catch {}
    if (!r.ok) { const err = new Error(data.error || "Algo correu mal. Tente outra vez."); err.status = r.status; throw err; }
    return data;
  }

  let cfg;
  try { cfg = await api("/api/config"); }
  catch (err) { document.body.prepend(h("p", { class: "msg", text: "Não foi possível carregar o site. Atualize a página. (" + (err && err.message ? err.message : "erro") + ")" })); return; }

  /* ---------- conteúdo fixo ---------- */
  document.title = `${cfg.name} · Barbearia em Fermentelos`;
  $("#tagline").textContent = cfg.tagline;
  $("#yr").textContent = `© ${new Date().getFullYear()}`;
  $("#addr").textContent = cfg.address;
  $("#mapFrame").src = "https://www.google.com/maps?q=" + encodeURIComponent(`${cfg.name}, ${cfg.address}`) + "&output=embed";

  $("#svcList").replaceChildren(...cfg.services.map((s) =>
    h("div", { class: "svc" }, h("b", { text: s.name }), h("span", { class: "price", text: eur(s.priceCents) }),
      h("p", { text: s.description || "" }), h("small", { text: `${s.minutes} min` }))));

  $("#svcOpts").replaceChildren(...cfg.services.map((s) =>
    h("div", { class: "opt" },
      h("input", { type: "radio", name: "svc", id: "s-" + s.id, value: s.id }),
      h("label", { for: "s-" + s.id }, h("span", {}, h("b", { text: s.name }), h("small", { text: `${s.minutes} min` })), h("b", { text: eur(s.priceCents) })))));

  const order = [1, 2, 3, 4, 5, 6, 0];
  $("#hoursList").replaceChildren(
    ...order.map((d) => { const x = cfg.hours[String(d)]; return h("li", {}, h("span", { text: WDL[d][0].toUpperCase() + WDL[d].slice(1) }), h("span", { text: x ? `${x[0]} – ${x[1]}` : "Fechado" })); }),
    ...(cfg.breakTime ? [h("li", {}, h("span", { text: "Pausa" }), h("span", { text: `${cfg.breakTime[0]} – ${cfg.breakTime[1]}` }))] : []));

  const ICONS = {
    phone: '<path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/>',
    whatsapp: '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3zm4.6 12.3c-.2.6-1.2 1.1-1.7 1.2-.4.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.6-2.6-1.1-4.3-3.8-4.4-4-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.5.2.3.7 1.2 1.6 1.9 1.1.9 2 1.2 2.3 1.4.3.1.4.1.6-.1l.8-1c.2-.2.4-.2.6-.1l1.9.9c.3.1.5.2.5.3 0 .1 0 .6-.2 1.2z"/>',
    instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.2"/>',
    facebook: '<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H7v4h3v7h4v-7h3l1-4h-4V8z"/>',
    star: '<path d="M12 2l3 6.5 7 .8-5.2 4.8 1.5 7-6.3-3.6-6.3 3.6 1.5-7L2 9.3l7-.8z"/>',
    pin: '<path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>',
  };
  function chip(icon, text, href, external) {
    const a = h("a", { class: "chip", href, rel: external ? "noopener" : false, target: external ? "_blank" : false });
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "20"); s.setAttribute("height", "20"); s.setAttribute("fill", "currentColor"); s.setAttribute("aria-hidden", "true");
    s.innerHTML = ICONS[icon];
    a.append(s, h("span", { text }));
    return a;
  }
  const telHref = cfg.phone ? "tel:" + cfg.phone.replace(/[^\d+]/g, "") : "";
  const waHref = cfg.whatsapp ? "https://wa.me/" + cfg.whatsapp.replace(/\D/g, "") : "";
  const contact = [];
  if (cfg.phone) contact.push(chip("phone", "Ligar", telHref));
  if (cfg.whatsapp) contact.push(chip("whatsapp", "WhatsApp", waHref, true));
  if (isHttps(cfg.mapsLink)) { contact.push(chip("pin", "Como chegar", cfg.mapsLink, true)); contact.push(chip("star", "Ver avaliações no Google", cfg.mapsLink, true)); }
  const social = [];
  if (isHttps(cfg.instagram)) social.push(chip("instagram", "Instagram", cfg.instagram, true));
  if (isHttps(cfg.facebook)) social.push(chip("facebook", "Facebook", cfg.facebook, true));
  $("#contactLinks").replaceChildren(...contact, ...social);
  $("#footLinks").replaceChildren(...[...social.map((n) => n.cloneNode(true))]);
  const quick = [];
  if (cfg.phone) quick.push(chip("phone", "Ligar", telHref));
  if (cfg.whatsapp) quick.push(chip("whatsapp", "WhatsApp", waHref, true));
  $("#quick").replaceChildren(...quick);
  if (cfg.phone) {
    $("#mbar").replaceChildren(h("a", { class: "btn ghost", href: telHref, text: "Ligar" }), h("a", { class: "btn", href: "#marcar", text: "Marcar" }));
    $("#mbar").hidden = false;
    document.body.classList.add("has-mbar");
  }

  if (cfg.team && cfg.team.length) {
    const initials = (n) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    $("#teamList").replaceChildren(...cfg.team.map((m) => h("div", { class: "member" },
      m.photo ? h("img", { src: m.photo, alt: m.name, loading: "lazy" }) : h("div", { class: "ph", "aria-hidden": "true", text: initials(m.name) }),
      h("b", { text: m.name }), h("span", { text: m.role || "" }))));
    $("#equipa").hidden = false;
  }
  if (cfg.gallery && cfg.gallery.length) {
    const lb = $("#lightbox");
    $("#galList").replaceChildren(...cfg.gallery.map((g) => {
      const btn = h("button", { class: "g-item", type: "button", "aria-label": "Ampliar: " + (g.caption || g.alt || "foto") },
        h("img", { src: g.src, alt: g.alt || "Trabalho da barbearia", loading: "lazy" }),
        g.caption ? h("span", { class: "g-cap", text: g.caption }) : null);
      btn.addEventListener("click", () => { $("#lbImg").src = g.src; $("#lbImg").alt = g.alt || ""; $("#lbCap").textContent = g.caption || ""; lb.showModal(); });
      return btn;
    }));
    $("#lbClose").addEventListener("click", () => lb.close());
    lb.addEventListener("click", (e) => { if (e.target === lb) lb.close(); });
    $("#galeria").hidden = false;
  }

  const faq = [
    ["Posso pagar só no dia?", "Sim. Escolha “Pagar no dia”, a hora fica marcada e paga na barbearia, depois do serviço."],
    ["Como funciona o pagamento online?", cfg.onlinePayments
      ? "Escolha “Pagar agora” e será levado para uma página segura, onde paga com MB WAY ou cartão. A hora só fica garantida depois do pagamento."
      : "O pagamento online ainda não está ativo. Por agora, pague no dia, na barbearia."],
    ["Posso cancelar?", `Sim, até ${cfg.cancelHoursBefore} horas antes, no botão “Cancelar marcação” que aparece quando confirma. Se já pagou online, contacte a barbearia para o reembolso.`],
    ["Onde fica a barbearia?", cfg.address + "."],
  ];
  $("#faqList").replaceChildren(...faq.map(([q, a]) => h("details", {}, h("summary", { text: q }), h("p", { text: a }))));

  /* ---------- marcação ---------- */
  const state = { svc: null, day: null, time: null };
  const payNowEl = $("#payNow");
  if (!cfg.onlinePayments) { payNowEl.disabled = true; $("#payNowSmall").textContent = "Ainda não está disponível"; }

  const closedDays = new Set(cfg.closedDays || []);
  const dayList = Array.from({ length: cfg.daysAhead + 1 }, (_, i) => addDays(cfg.today, i));
  $("#dayOpts").replaceChildren(...dayList.map((ds) => {
    const d = new Date(ds + "T00:00:00Z"), open = Boolean(cfg.hours[String(weekday(ds))]) && !closedDays.has(ds) && !(ds === cfg.today && cfg.todayFull);
    return h("div", { class: "opt" },
      h("input", { type: "radio", name: "day", id: "d-" + ds, value: ds, disabled: !open }),
      h("label", { for: "d-" + ds }, h("span", { text: WD[d.getUTCDay()] }), h("b", { text: String(d.getUTCDate()) }), h("span", { text: MO[d.getUTCMonth()] })));
  }));

  let slotReq = 0;
  async function loadSlots() {
    const box = $("#slotBox");
    if (!state.svc || !state.day) { box.replaceChildren(h("div", { class: "msg", text: "Escolha primeiro o serviço e o dia." })); return; }
    const mine = ++slotReq;
    box.replaceChildren(h("div", { class: "msg", text: "A ver as horas livres…" }));
    try {
      const { slots } = await api(`/api/availability?service=${encodeURIComponent(state.svc.id)}&day=${state.day}`);
      if (mine !== slotReq) return;
      if (!slots.some((s) => s.ok)) { state.time = null; box.replaceChildren(h("div", { class: "msg", text: "Sem horas livres neste dia. Experimente outro dia." })); refresh(); return; }
      if (state.time && !slots.find((s) => s.time === state.time && s.ok)) state.time = null;
      box.replaceChildren(h("div", { class: "slots", role: "radiogroup", "aria-label": "Hora" }, ...slots.map((s) =>
        h("div", { class: "opt" },
          h("input", { type: "radio", name: "time", id: "t-" + s.time, value: s.time, disabled: !s.ok, checked: state.time === s.time }),
          h("label", { for: "t-" + s.time, text: s.time })))));
      refresh();
    } catch (e) { if (mine === slotReq) box.replaceChildren(h("div", { class: "msg", text: e.message })); }
  }

  function refresh() {
    const payNow = payNowEl.checked;
    $("#sSvc").textContent = state.svc ? state.svc.name : "—";
    $("#sDay").textContent = state.day ? longDay(state.day) : "—";
    $("#sTime").textContent = state.time || "—";
    $("#sPay").textContent = payNow ? "Agora" : "No dia";
    $("#sTotal").textContent = state.svc ? eur(state.svc.priceCents) : "—";
    const ready = state.svc && state.day && state.time;
    $("#submit").disabled = !ready;
    $("#submit").textContent = payNow ? "Continuar para o pagamento" : "Confirmar marcação";
    $("#hint").textContent = ready ? (payNow ? "No passo seguinte escolhe MB WAY ou cartão. A hora fica garantida depois do pagamento." : "Paga só quando chegar à barbearia.") : "Escolha serviço, dia e hora para continuar.";
  }

  $("#form").addEventListener("change", (e) => {
    const n = e.target.name;
    if (n === "svc") state.svc = cfg.services.find((s) => s.id === e.target.value);
    if (n === "day") state.day = e.target.value;
    if (n === "time") state.time = e.target.value;
    if (n === "svc" || n === "day") loadSlots();
    refresh();
  });

  /* ---------- validação e envio ---------- */
  function setErr(id, msg) { $("#e-" + id).textContent = msg || ""; $("#" + id).setAttribute("aria-invalid", msg ? "true" : "false"); return !msg; }
  function validate() {
    const nome = $("#nome").value.trim(), tel = $("#tel").value.replace(/[\s.\-()]/g, ""), mail = $("#email").value.trim();
    const oks = [
      [setErr("nome", nome.length < 2 ? "Indique o seu nome." : ""), "#nome"],
      [setErr("tel", /^(\+351)?[239]\d{8}$/.test(tel) ? "" : "Indique um telemóvel português com 9 dígitos."), "#tel"],
      [setErr("email", mail && !/^\S+@\S+\.\S+$/.test(mail) ? "Este email não parece correto." : ""), "#email"],
    ];
    const bad = oks.find(([ok]) => !ok);
    if (bad) $(bad[1]).focus();
    return !bad;
  }

  // Funciona por clique direto: algumas pré-visualizações bloqueiam o envio de formulários (sandbox sem allow-forms).
  $("#form").addEventListener("submit", (e) => e.preventDefault());
  $("#submit").addEventListener("click", (e) => { e.preventDefault(); submitBooking(); });
  $("#form").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "radio") { e.preventDefault(); if (!$("#submit").disabled) submitBooking(); } });

  async function submitBooking() {
    if ($("#submit").disabled) return;
    $("#e-form").textContent = "";
    if (!(state.svc && state.day && state.time) || !validate()) return;
    const btn = $("#submit"); btn.disabled = true; btn.textContent = "A guardar…";
    const payNow = payNowEl.checked;
    try {
      const out = await api("/api/bookings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: state.svc.id, day: state.day, time: state.time, name: $("#nome").value, phone: $("#tel").value, email: $("#email").value, payMode: payNow ? "now" : "later" }),
      });
      if (out.checkoutUrl) {
        if (typeof window.apbDemoCheckout === "function") {
          // só na demonstração: página de pagamento simulada, sem sair do site
          const paid = await window.apbDemoCheckout(out.booking);
          if (paid) {
            const r = await api(`/api/bookings/${encodeURIComponent(out.booking.id)}?token=${encodeURIComponent(out.token)}`);
            showBooking(r.booking, out.token);
          } else {
            $("#e-form").textContent = "Pagamento cancelado. A hora foi libertada: escolha uma hora e tente outra vez.";
            state.time = null; loadSlots();
          }
          refresh(); return;
        }
        location.href = out.checkoutUrl; return;
      }
      showBooking(out.booking, out.token);
    } catch (err) {
      $("#e-form").textContent = err.message;
      if (err.status === 409) { state.time = null; loadSlots(); }
    }
    refresh();
  }

  /* ---------- janela de confirmação ---------- */
  const dlg = $("#done");
  function showBooking(b, token, opts = {}) {
    $("#dTitle").textContent = opts.title || (b.status === "paga" ? "Marcação paga" : b.status === "cancelada" ? "Marcação cancelada" : "Marcação confirmada");
    const body = [h("p", {}, h("b", { text: b.service }), `, ${longDay(b.day)} às `, h("b", { text: b.time }), ".")];
    body.push(h("p", { text: cfg.address + "." }));
    if (b.status === "confirmada") body.push(h("p", {}, "Total a pagar no dia: ", h("b", { text: eur(b.priceCents) }), "."));
    if (b.status === "paga") body.push(h("p", { text: "Pagamento recebido. Obrigado!" }));
    if (b.status === "a_aguardar_pagamento") body.push(h("p", { text: "Ainda não recebemos o pagamento. Pode demorar um minuto a confirmar." }));
    if (opts.note) body.push(h("p", { text: opts.note }));
    $("#dBody").replaceChildren(...body);
    $("#dRef").textContent = "Referência " + b.id;
    const acts = [h("button", { class: "btn", type: "button", id: "dClose", text: "Fechar" })];
    if (b.status !== "cancelada") {
      const stamp = (mins) => b.day.replace(/-/g, "") + "T" + pad2(Math.floor(mins / 60)) + pad2(mins % 60) + "00";
      const startMin = Number(b.time.slice(0, 2)) * 60 + Number(b.time.slice(3, 5));
      const gcal = "https://calendar.google.com/calendar/render?" + new URLSearchParams({
        action: "TEMPLATE", text: `${b.service} — ${cfg.name}`, dates: `${stamp(startMin)}/${stamp(startMin + b.minutes)}`,
        details: `Marcação ${b.id}`, location: cfg.address,
      }).toString();
      acts.push(h("a", { class: "btn ghost", href: gcal, target: "_blank", rel: "noopener", text: "Google Calendar" }));
      acts.push(h("button", { class: "btn ghost", type: "button", id: "dCancel", text: "Cancelar marcação" }));
    }
    $("#dActs").replaceChildren(...acts);
    $("#dClose")?.addEventListener("click", () => { dlg.close(); if (!opts.keepPage) location.reload(); });
    $("#dCancel")?.addEventListener("click", async () => {
      try {
        const out = await api(`/api/bookings/${encodeURIComponent(b.id)}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
        showBooking(out.booking, token, { keepPage: opts.keepPage });
      } catch (err) { $("#dBody").append(h("p", { class: "err", text: err.message })); }
    });
    if (!dlg.open) dlg.showModal();
  }

  /* ---------- regresso do pagamento ---------- */
  const q = new URLSearchParams(location.search);
  const paidId = q.get("pago"), canceledId = q.get("cancelado"), tok = q.get("t");
  if ((paidId || canceledId) && tok) {
    history.replaceState(null, "", location.pathname);
    try {
      if (canceledId) {
        const out = await api(`/api/bookings/${encodeURIComponent(canceledId)}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tok }) });
        showBooking(out.booking, tok, { title: "Pagamento cancelado", note: "A hora foi libertada. Pode escolher outra e tentar de novo.", keepPage: true });
      } else {
        let out;
        for (let i = 0; i < 6; i++) {
          out = await api(`/api/bookings/${encodeURIComponent(paidId)}?token=${encodeURIComponent(tok)}`);
          if (out.booking.status !== "a_aguardar_pagamento") break;
          await new Promise((r) => setTimeout(r, 2000));
        }
        showBooking(out.booking, tok, { keepPage: true });
      }
    } catch (err) {
      document.querySelector("#marcar .wrap").prepend(h("p", { class: "msg", text: err.message }));
    }
  }

  refresh();
})();
