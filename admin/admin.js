"use strict";
(async function () {
  const $ = (s) => document.querySelector(s);
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v == null || k === "style") continue; // sem estilos inline (CSP)
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
    return e;
  }

  /* ---------- datas e formatos ---------- */
  const WD3 = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const WDL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const MO3 = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const dObj = (ds) => new Date(ds + "T00:00:00Z");
  const addDays = (ds, n) => { const d = dObj(ds); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const addMonths = (ds, n) => { const d = dObj(ds.slice(0, 8) + "01"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
  const dow = (ds) => dObj(ds).getUTCDay();
  const fmtDay = (ds) => `${WD3[dow(ds)]}, ${dObj(ds).getUTCDate()} ${MO3[dObj(ds).getUTCMonth()]}`;
  const fmtLong = (ds) => `${WDL[dow(ds)]}, ${dObj(ds).getUTCDate()} de ${MONTHS[dObj(ds).getUTCMonth()]}`;
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const eur = (c) => (c / 100).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
  const sum = (arr) => arr.reduce((a, b) => a + b.priceCents, 0);
  const firstName = (n) => n.split(/\s+/)[0];

  /* ---------- estado ---------- */
  const state = { cfg: null, today: "", bookings: [], blocks: [], tab: "hoje", month: "", day: "",
    q: "", fStatus: "ativas", fPeriod: "futuras", payPeriod: "mes", cq: "", showCancelled: false };
  const view = $("#view"), dlg = $("#dlg"), dlgBody = $("#dlgBody");
  const IS_DEMO = typeof window.apbDemoCheckout === "function";

  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    let data = {}; try { data = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(data.error || "Algo correu mal. Tente outra vez."); e.status = r.status; throw e; }
    return data;
  }
  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 3200); }

  /* ---------- estados e pagamentos ---------- */
  const STATUS = { confirmada: "Confirmada", paga: "Paga", a_aguardar_pagamento: "A aguardar pagamento", cancelada: "Cancelada", concluida: "Concluída", faltou: "Não compareceu" };
  function payInfo(b) {
    if (b.status === "cancelada") return { k: "na", label: "—" };
    if (b.status === "faltou") return { k: "na", label: "Não cobrado" };
    if (b.status === "a_aguardar_pagamento") return { k: "pending", label: "A aguardar (online)" };
    if (b.payMode === "now") return { k: "paid", label: "Pago online" };
    if (b.status === "paga" || b.status === "concluida") return { k: "paid", label: "Pago no balcão" };
    return { k: "due", label: "Por pagar no dia" };
  }
  const active = (b) => b.status !== "cancelada";
  const byTime = (a, b) => (a.day + a.time).localeCompare(b.day + b.time);
  const tagS = (b) => h("span", { class: `tag s-${b.status}`, text: STATUS[b.status] || b.status });
  const tagP = (b) => { const p = payInfo(b); return p.k === "na" ? null : h("span", { class: `tag p-${p.k}`, text: p.label }); };
  const phoneDigits = (p) => { const d = String(p).replace(/\D/g, ""); return d.length === 9 ? "351" + d : d; };

  function bookingRow(b, showDay) {
    return h("button", { class: "row" + (b.status === "cancelada" ? " dim" : ""), type: "button", on: { click: () => openDetail(b.id) } },
      h("div", { class: "t" }, b.time, showDay ? h("small", { text: fmtDay(b.day) }) : null),
      h("div", { class: "m" }, h("b", { text: b.name }), h("span", { text: `${b.service} · ${eur(b.priceCents)}` })),
      h("div", { class: "tg" }, tagS(b), tagP(b)));
  }

  /* ---------- janela ---------- */
  function openDlg(nodes) { dlgBody.replaceChildren(...nodes); if (!dlg.open) dlg.showModal(); }
  function closeDlg() { if (dlg.open) dlg.close(); }
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDlg(); });

  async function setStatus(id, status, msg) {
    try {
      await api(`/api/admin/bookings/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) });
      toast(msg || "Estado atualizado"); closeDlg(); await loadAll(true);
    } catch (e) { toast(e.message); }
  }

  function openDetail(id) {
    const b = state.bookings.find((x) => x.id === id); if (!b) return;
    const p = payInfo(b);
    const dl = h("dl", { class: "dl" });
    const row = (k, v) => dl.append(h("dt", { text: k }), h("dd", {}, v));
    row("Cliente", b.name);
    row("Telemóvel", h("a", { href: "tel:" + b.phone, text: b.phone }));
    if (b.email) row("Email", h("a", { href: "mailto:" + b.email, text: b.email }));
    row("Serviço", `${b.service} (${b.minutes} min)`);
    row("Dia", fmtLong(b.day));
    row("Hora", `${b.time} – ${String(Math.floor((toMin(b.time) + b.minutes) / 60)).padStart(2, "0")}:${String((toMin(b.time) + b.minutes) % 60).padStart(2, "0")}`);
    row("Valor", eur(b.priceCents));
    row("Pagamento", p.label);
    row("Referência", b.id);

    const acts = h("div", { class: "acts" });
    const add = (txt, cls, fn) => acts.append(h("button", { class: `btn sm ${cls}`, type: "button", on: { click: fn } }, txt));
    if (b.status === "confirmada") {
      add("Concluída e paga", "ok", () => setStatus(b.id, "concluida", "Marcação concluída e paga"));
      add("Já pagou", "ghost", () => setStatus(b.id, "paga", "Marcada como paga"));
      add("Não compareceu", "ghost", () => setStatus(b.id, "faltou"));
    } else if (b.status === "paga") {
      add("Concluída", "ok", () => setStatus(b.id, "concluida", "Marcação concluída"));
      add("Não compareceu", "ghost", () => setStatus(b.id, "faltou"));
    } else if (b.status === "a_aguardar_pagamento") {
      add("Confirmar que recebi", "ok", () => setStatus(b.id, "paga", "Marcada como paga"));
    } else if (b.status === "concluida" || b.status === "faltou") {
      add("Repor como confirmada", "ghost", () => setStatus(b.id, "confirmada"));
    }
    if (b.status !== "cancelada" && b.status !== "concluida" && b.status !== "faltou") {
      let armed = false;
      const c = h("button", { class: "btn sm danger", type: "button" }, "Cancelar marcação");
      c.addEventListener("click", () => { if (!armed) { armed = true; c.textContent = "Confirmar cancelamento"; return; } setStatus(b.id, "cancelada", "Marcação cancelada"); });
      acts.append(c);
    }
    const wa = h("a", { class: "btn sm ghost", href: "https://wa.me/" + phoneDigits(b.phone), target: "_blank", rel: "noopener", text: "WhatsApp" });
    const call = h("a", { class: "btn sm ghost", href: "tel:" + b.phone, text: "Ligar" });
    acts.append(call, wa);
    const note = b.payMode === "now" && p.k === "paid" && b.status !== "cancelada"
      ? h("p", { class: "note", text: "Pagou online. Se cancelar, faça o reembolso no painel do Stripe." }) : null;
    openDlg([h("h2", { id: "dlgTitle" }, b.name), h("div", { class: "tags-line" }, tagS(b), " ", tagP(b)), dl, note, acts,
      h("div", { class: "acts" }, h("button", { class: "btn sm ghost", type: "button", on: { click: closeDlg } }, "Fechar"))]);
  }

  /* ---------- nova marcação ---------- */
  function firstOpenDay(from) {
    for (let i = 0; i <= 30; i++) {
      const d = addDays(from, i);
      if (state.cfg.hours[String(dow(d))] && !(state.cfg.closedDays || []).includes(d)) return d;
    }
    return from;
  }
  function openNew(day) {
    const f = { svc: state.cfg.services[0].id, day: day && day >= state.today ? day : firstOpenDay(state.today), time: "", paid: false };
    const svc = h("select", { id: "nb-svc" }, state.cfg.services.map((s) => h("option", { value: s.id }, `${s.name} · ${s.minutes} min · ${eur(s.priceCents)}`)));
    const date = h("input", { type: "date", id: "nb-day", min: state.today, max: addDays(state.today, state.cfg.daysAhead), value: f.day });
    const slotBox = h("div");
    const name = h("input", { id: "nb-name", maxlength: "80", autocomplete: "off" });
    const phone = h("input", { id: "nb-phone", type: "tel", inputmode: "tel", maxlength: "20", autocomplete: "off", placeholder: "912 345 678" });
    const email = h("input", { id: "nb-email", type: "email", maxlength: "120", autocomplete: "off" });
    const err = h("div", { class: "err", role: "alert" });
    const create = h("button", { class: "btn", type: "button" }, "Criar marcação");
    let req = 0;
    async function loadSlots() {
      f.time = ""; const mine = ++req;
      if (!f.day) { slotBox.replaceChildren(h("p", { class: "muted", text: "Escolha um dia." })); return; }
      slotBox.replaceChildren(h("p", { class: "muted", text: "A ver as horas livres…" }));
      try {
        const { slots } = await api(`/api/availability?service=${encodeURIComponent(f.svc)}&day=${f.day}`);
        if (mine !== req) return;
        if (!slots.some((s) => s.ok)) { slotBox.replaceChildren(h("p", { class: "muted", text: "Sem horas livres neste dia." })); return; }
        const wrap = h("div", { class: "slots" });
        slots.forEach((s) => {
          const bt = h("button", { class: "slot", type: "button", "aria-pressed": "false", disabled: !s.ok }, s.time);
          bt.addEventListener("click", () => { f.time = s.time; wrap.querySelectorAll(".slot").forEach((x) => x.setAttribute("aria-pressed", String(x === bt))); });
          wrap.append(bt);
        });
        slotBox.replaceChildren(wrap);
      } catch (e) { if (mine === req) slotBox.replaceChildren(h("p", { class: "err", text: e.message })); }
    }
    svc.addEventListener("change", () => { f.svc = svc.value; loadSlots(); });
    date.addEventListener("change", () => { f.day = date.value; loadSlots(); });
    const payLater = h("input", { type: "radio", name: "nb-pay", id: "nb-later", checked: true });
    const payNow = h("input", { type: "radio", name: "nb-pay", id: "nb-now" });
    create.addEventListener("click", async () => {
      err.textContent = "";
      if (!f.time) { err.textContent = "Escolha uma hora."; return; }
      create.disabled = true;
      try {
        await api("/api/admin/bookings", { method: "POST", body: JSON.stringify({ serviceId: f.svc, day: f.day, time: f.time, name: name.value, phone: phone.value, email: email.value, paid: payNow.checked }) });
        toast("Marcação criada"); closeDlg(); state.tab = "calendario"; state.day = f.day; state.month = f.day.slice(0, 8) + "01"; await loadAll(true);
      } catch (e) { err.textContent = e.message; if (e.status === 409) loadSlots(); }
      create.disabled = false;
    });
    const field = (label, ctl, id) => h("div", { class: "field" }, h("label", { for: id }, label), ctl);
    openDlg([h("h2", { id: "dlgTitle" }, "Nova marcação"), h("p", { class: "muted", text: "Para clientes que marcam por telefone ou no balcão." }),
      field("Serviço", svc, "nb-svc"), field("Dia", date, "nb-day"), h("div", { class: "field" }, h("span", { class: "lab" }, "Hora"), slotBox),
      field("Nome", name, "nb-name"), field("Telemóvel", phone, "nb-phone"), field("Email (opcional)", email, "nb-email"),
      h("div", { class: "field" }, h("span", { class: "lab" }, "Pagamento"),
        h("div", { class: "seg" }, h("label", { for: "nb-later" }, payLater, "Paga no dia"), h("label", { for: "nb-now" }, payNow, "Já pagou no balcão"))),
      err, h("div", { class: "acts" }, create, h("button", { class: "btn ghost", type: "button", on: { click: closeDlg } }, "Cancelar"))]);
    loadSlots();
  }

  /* ---------- HOJE ---------- */
  function viewHoje() {
    const t = state.today;
    const isOpen = (d) => Boolean(state.cfg.hours[String(dow(d))]) && !state.blocks.some((x) => x.day === d && !x.from);
    // se hoje estiver fechado, mostra o próximo dia de abertura para o painel não parecer vazio
    let day = t; if (!isOpen(t)) for (let i = 1; i <= 14; i++) if (isOpen(addDays(t, i))) { day = addDays(t, i); break; }
    const isToday = day === t, W = isToday ? "hoje" : fmtDay(day);
    const list = state.bookings.filter((b) => b.day === day && active(b)).sort(byTime);
    const dueToday = list.filter((b) => payInfo(b).k === "due");
    const paidToday = list.filter((b) => payInfo(b).k === "paid");
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    const next = list.find((b) => !["concluida", "faltou"].includes(b.status) && (!isToday || toMin(b.time) + b.minutes > nowMin));
    const pendings = state.bookings.filter((b) => b.status === "a_aguardar_pagamento" && b.day >= t);

    const kpis = h("div", { class: "kpis" },
      kpi(`Marcações ${W}`, String(list.length), `${list.filter((b) => b.status === "concluida").length} concluídas`),
      kpi(`Por receber ${W}`, eur(sum(dueToday)), `${dueToday.length} no balcão`, "warn"),
      kpi(`Já pago ${W}`, eur(sum(paidToday)), `${paidToday.length} marcações`, "ok"),
      kpi("Próxima", next ? next.time : "—", next ? `${firstName(next.name)} · ${next.service}` : "Nada pendente"));

    const agenda = h("div", { class: "card" }, h("h3", { text: isToday ? `Hoje, ${fmtLong(day)}` : fmtLong(day) }),
      isToday ? null : h("p", { class: "note", text: "Hoje a barbearia está fechada. Aqui está o próximo dia de abertura." }),
      list.length ? h("div", { class: "list" }, list.map((b) => bookingRow(b))) : h("p", { class: "empty", text: "Ainda não há marcações neste dia." }));

    const days = Array.from({ length: 7 }, (_, i) => addDays(t, i));
    const counts = days.map((d) => state.bookings.filter((b) => b.day === d && active(b)).length);
    const max = Math.max(1, ...counts);
    const week = h("div", { class: "week", role: "img", "aria-label": "Marcações nos próximos 7 dias: " + days.map((d, i) => `${fmtDay(d)} ${counts[i]}`).join(", ") },
      days.map((d, i) => { const bar = h("div", { class: "bar" }); bar.style.setProperty("--h", Math.round((counts[i] / max) * 100) + "%");
        return h("div", { class: "wd" + (i === 0 ? " today" : "") }, h("div", { class: "bar-w" }, bar), h("b", { text: String(counts[i]) }), h("span", { text: WD3[dow(d)] })); }));
    const upcoming = state.bookings.filter((b) => b.day > day && active(b)).sort(byTime).slice(0, 5);
    const side = h("div", { class: "grid" },
      pendings.length ? h("p", { class: "note", text: `${pendings.length} marcação(ões) à espera de pagamento online. Se não pagarem, a hora é libertada sozinha.` }) : null,
      h("div", { class: "card" }, h("h3", { text: "Próximos 7 dias" }), week),
      h("div", { class: "card" }, h("h3", { text: "Seguintes" }), upcoming.length ? h("div", { class: "list" }, upcoming.map((b) => bookingRow(b, true))) : h("p", { class: "muted", text: "Sem mais marcações." })));
    return [kpis, h("div", { class: "two" }, agenda, side)];
  }
  function kpi(l, v, s, cls) { return h("div", { class: "kpi " + (cls || "") }, h("div", { class: "l", text: l }), h("div", { class: "v", text: v }), h("div", { class: "s", text: s })); }

  /* ---------- CALENDÁRIO ---------- */
  function viewCal() {
    const m = state.month, startDow = (dow(m) + 6) % 7, gridStart = addDays(m, -startDow);
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    while (days.length > 35 && days.slice(-7).every((d) => d.slice(0, 7) !== m.slice(0, 7))) days.splice(-7);
    const byDay = {}; state.bookings.filter(active).forEach((b) => (byDay[b.day] ||= []).push(b));
    Object.values(byDay).forEach((a) => a.sort(byTime));
    const full = new Set(state.blocks.filter((x) => !x.from).map((x) => x.day)), part = new Set(state.blocks.filter((x) => x.from).map((x) => x.day));

    const head = h("div", { class: "cal-head" },
      h("button", { class: "btn ghost sm", type: "button", "aria-label": "Mês anterior", on: { click: () => { state.month = addMonths(m, -1); render(); } } }, "‹"),
      h("h2", { text: `${MONTHS[dObj(m).getUTCMonth()]} ${dObj(m).getUTCFullYear()}` }),
      h("button", { class: "btn ghost sm", type: "button", on: { click: () => { state.month = state.today.slice(0, 8) + "01"; state.day = state.today; render(); } } }, "Hoje"),
      h("button", { class: "btn ghost sm", type: "button", "aria-label": "Mês seguinte", on: { click: () => { state.month = addMonths(m, 1); render(); } } }, "›"));
    const grid = h("div", { class: "cal" }, ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((n) => h("div", { class: "dow", text: n })));
    days.forEach((d) => {
      const list = byDay[d] || [], inMonth = d.slice(0, 7) === m.slice(0, 7), closedWk = !state.cfg.hours[String(dow(d))];
      const cell = h("div", { class: ["cell", inMonth ? "" : "out", d === state.today ? "today" : "", d === state.day ? "sel" : "", closedWk ? "closed" : "", full.has(d) ? "blocked" : ""].filter(Boolean).join(" ") });
      const num = h("button", { class: "num", type: "button", "aria-label": `${fmtLong(d)}: ${list.length} marcações${full.has(d) ? ", folga" : ""}`, on: { click: (e) => { e.stopPropagation(); selectDay(d); } } }, String(dObj(d).getUTCDate()));
      cell.append(num);
      if (full.has(d)) cell.append(h("span", { class: "cnt", text: "Folga" }));
      else if (list.length) cell.append(h("span", { class: "cnt" }, String(list.length), h("span", { class: "w", text: " marc." })));
      list.slice(0, 3).forEach((b) => cell.append(h("button", { class: `chip s-${b.status}`, type: "button", title: `${b.time} ${b.name} · ${b.service}`, on: { click: (e) => { e.stopPropagation(); selectDay(d, true); openDetail(b.id); } } }, `${b.time} `, h("span", { text: firstName(b.name) }))));
      if (list.length > 3) cell.append(h("span", { class: "more", text: `+${list.length - 3} mais` }));
      else if (part.has(d) && !full.has(d)) cell.append(h("span", { class: "more", text: "Bloqueio parcial" }));
      if (list.length) cell.append(h("div", { class: "dot-row" }, list.slice(0, 8).map((b) => h("i", { class: `dot s-${b.status}` }))));
      cell.addEventListener("click", () => selectDay(d));
      grid.append(cell);
    });
    const legend = h("div", { class: "legend" }, ...[["s-confirmada", "Paga no dia"], ["s-paga", "Paga"], ["s-a_aguardar_pagamento", "A aguardar pagamento"], ["s-concluida", "Concluída"], ["s-faltou", "Não compareceu"]].map(([c, t]) => h("span", { class: c }, h("i"), t)));

    /* painel do dia */
    const sel = state.day, list = (state.bookings.filter((b) => b.day === sel && (state.showCancelled || active(b)))).sort(byTime);
    const fullBlocks = state.blocks.filter((x) => x.day === sel);
    const closedWk = !state.cfg.hours[String(dow(sel))];
    const panel = h("div", { class: "card" }, h("h3", { text: fmtLong(sel) }),
      h("p", { class: "muted small", text: closedWk ? "Dia de folga semanal." : `${list.filter(active).length} marcações · ${eur(sum(list.filter(active)))}` }),
      h("div", { class: "acts" },
        h("button", { class: "btn sm", type: "button", on: { click: () => openNew(sel) } }, "Nova marcação"),
        fullBlocks.some((x) => !x.from) ? null : h("button", { class: "btn sm ghost", type: "button", on: { click: () => blockDay(sel) } }, "Marcar folga")),
      fullBlocks.map((x) => h("p", { class: "note" }, `${x.from ? `Bloqueado ${x.from}–${x.to}` : "Folga"}${x.reason ? ": " + x.reason : ""} `, h("button", { class: "btn sm ghost", type: "button", on: { click: () => removeBlock(x.id) } }, "Remover"))),
      h("label", { class: "small muted" }, h("input", { type: "checkbox", checked: state.showCancelled, on: { change: (e) => { state.showCancelled = e.target.checked; render(); } } }), " Mostrar canceladas"),
      list.length ? h("div", { class: "list" }, list.map((b) => bookingRow(b))) : h("p", { class: "empty", text: "Sem marcações neste dia." }));
    return [h("div", { class: "two" }, h("div", {}, head, grid, legend), panel)];
  }
  function selectDay(d, keepMonth) {
    state.day = d; if (!keepMonth && d.slice(0, 7) !== state.month.slice(0, 7)) state.month = d.slice(0, 8) + "01";
    if (!dlg.open) render();
  }
  async function blockDay(day) {
    try { await api("/api/admin/blocks", { method: "POST", body: JSON.stringify({ day, reason: "Folga" }) }); toast("Dia marcado como folga"); await loadAll(true); }
    catch (e) { toast(e.message); }
  }
  async function removeBlock(id) {
    try { await api(`/api/admin/blocks/${encodeURIComponent(id)}`, { method: "DELETE" }); toast("Bloqueio removido"); await loadAll(true); }
    catch (e) { toast(e.message); }
  }

  /* ---------- MARCAÇÕES ---------- */
  function viewList() {
    const t = state.today, q = state.q.trim().toLowerCase();
    let rows = state.bookings.filter((b) => {
      if (state.fStatus === "ativas" && !active(b)) return false;
      if (!["ativas", "todas"].includes(state.fStatus) && b.status !== state.fStatus) return false;
      if (state.fPeriod === "futuras" && b.day < t) return false;
      if (state.fPeriod === "hoje" && b.day !== t) return false;
      if (state.fPeriod === "7d" && (b.day < t || b.day > addDays(t, 7))) return false;
      if (state.fPeriod === "passadas" && b.day >= t) return false;
      if (q && !(`${b.name} ${b.phone} ${b.id} ${b.service}`.toLowerCase().includes(q))) return false;
      return true;
    }).sort(byTime);
    if (["passadas", "todas"].includes(state.fPeriod)) rows.reverse();
    const search = h("input", { type: "search", placeholder: "Procurar por nome, telefone ou referência", value: state.q, "aria-label": "Procurar" });
    search.addEventListener("input", () => { state.q = search.value; const pos = search.selectionStart; render(); const s = $("#view input[type=search]"); if (s) { s.focus(); s.setSelectionRange(pos, pos); } });
    const sel = (opts, val, key) => { const s = h("select", { "aria-label": key }, opts.map(([v, l]) => h("option", { value: v, selected: v === val }, l))); s.addEventListener("change", () => { state[key === "Estado" ? "fStatus" : "fPeriod"] = s.value; render(); }); return s; };
    const filters = h("div", { class: "filters" }, search,
      sel([["futuras", "Daqui para a frente"], ["hoje", "Hoje"], ["7d", "Próximos 7 dias"], ["passadas", "Passadas"], ["todas", "Todas as datas"]], state.fPeriod, "Período"),
      sel([["ativas", "Todas (menos canceladas)"], ["todas", "Incluir canceladas"], ["confirmada", "Paga no dia"], ["paga", "Pagas"], ["a_aguardar_pagamento", "A aguardar pagamento"], ["concluida", "Concluídas"], ["faltou", "Não compareceu"], ["cancelada", "Canceladas"]], state.fStatus, "Estado"));
    const table = h("div", { class: "tbl-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Data", "Hora", "Cliente", "Serviço", "Pagamento", "Estado"].map((x) => h("th", { text: x })), h("th", { class: "r", text: "Valor" }))),
      h("tbody", {}, rows.map((b) => h("tr", { class: "click", tabindex: "0", on: { click: () => openDetail(b.id), keydown: (e) => { if (e.key === "Enter") openDetail(b.id); } } },
        h("td", { text: fmtDay(b.day) }), h("td", { text: b.time }), h("td", {}, h("b", { text: b.name }), h("div", { class: "muted small", text: b.phone })),
        h("td", { text: b.service }), h("td", {}, tagP(b) || "—"), h("td", {}, tagS(b)), h("td", { class: "r", text: eur(b.priceCents) }))))));
    return [h("h2", { text: "Marcações" }), filters, h("p", { class: "muted small", text: `${rows.length} marcações` }), rows.length ? table : h("p", { class: "empty", text: "Nenhuma marcação com estes filtros." })];
  }

  /* ---------- PAGAMENTOS ---------- */
  function inPayPeriod(day) {
    const t = state.today, p = state.payPeriod;
    if (p === "mes") return day.slice(0, 7) === t.slice(0, 7);
    if (p === "passado") return day.slice(0, 7) === addMonths(t, -1).slice(0, 7);
    if (p === "30d") return day >= addDays(t, -30) && day <= t;
    return true;
  }
  function viewPay() {
    const rows = state.bookings.filter((b) => payInfo(b).k !== "na" && inPayPeriod(b.day)).sort(byTime).reverse();
    const of = (k, mode) => rows.filter((b) => payInfo(b).k === k && (!mode || b.payMode === mode));
    const onl = of("paid", "now"), bal = of("paid", "later"), due = of("due"), pend = of("pending");
    const kpis = h("div", { class: "kpis" },
      kpi("Recebido online", eur(sum(onl)), `${onl.length} pagamentos`, "ok"),
      kpi("Recebido no balcão", eur(sum(bal)), `${bal.length} pagamentos`, "ok"),
      kpi("Por receber no dia", eur(sum(due)), `${due.length} marcações`, "warn"),
      kpi("A aguardar (online)", eur(sum(pend)), `${pend.length} marcações`));
    const perSvc = {}; of("paid").forEach((b) => { perSvc[b.service] = (perSvc[b.service] || 0) + b.priceCents; });
    const entries = Object.entries(perSvc).sort((a, b) => b[1] - a[1]); const mx = Math.max(1, ...entries.map((e) => e[1]));
    const bars = h("div", { class: "bars" }, entries.length ? entries.map(([n, v]) => { const fl = h("div", { class: "fl" }); fl.style.setProperty("--w", Math.round((v / mx) * 100) + "%"); return h("div", { class: "brow" }, h("span", { text: n }), h("div", { class: "tr" }, fl), h("b", { text: eur(v) })); }) : h("p", { class: "muted", text: "Ainda sem pagamentos neste período." }));
    const per = h("select", { "aria-label": "Período" }, [["mes", "Este mês"], ["passado", "Mês passado"], ["30d", "Últimos 30 dias"], ["tudo", "Tudo"]].map(([v, l]) => h("option", { value: v, selected: v === state.payPeriod }, l)));
    per.addEventListener("change", () => { state.payPeriod = per.value; render(); });
    const exp = h("button", { class: "btn ghost sm", type: "button", on: { click: () => exportCsv(rows) } }, "Exportar CSV");
    const table = h("div", { class: "tbl-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Data", "Cliente", "Serviço", "Como"].map((x) => h("th", { text: x })), h("th", { text: "Estado" }), h("th", { class: "r", text: "Valor" }))),
      h("tbody", {}, rows.map((b) => h("tr", { class: "click", tabindex: "0", on: { click: () => openDetail(b.id), keydown: (e) => { if (e.key === "Enter") openDetail(b.id); } } },
        h("td", { text: `${fmtDay(b.day)} ${b.time}` }), h("td", { text: b.name }), h("td", { text: b.service }), h("td", { text: b.payMode === "now" ? "Online" : "No balcão" }),
        h("td", {}, tagP(b)), h("td", { class: "r", text: eur(b.priceCents) }))))));
    return [h("div", { class: "filters" }, h("h2", { text: "Pagamentos" }), per, exp), kpis,
      h("div", { class: "two" }, rows.length ? table : h("p", { class: "empty", text: "Sem pagamentos neste período." }), h("div", { class: "card" }, h("h3", { text: "Recebido por serviço" }), bars))];
  }
  function exportCsv(rows) {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const head = ["Data", "Hora", "Cliente", "Telemóvel", "Serviço", "Como", "Estado do pagamento", "Valor (€)"];
    const lines = [head.map(esc).join(";"), ...rows.map((b) => [b.day, b.time, b.name, b.phone, b.service, b.payMode === "now" ? "Online" : "No balcão", payInfo(b).label, (b.priceCents / 100).toFixed(2).replace(".", ",")].map(esc).join(";"))];
    try {
      const a = h("a", { href: URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" })), download: `pagamentos-${state.today}.csv` });
      a.click(); toast("Ficheiro exportado");
    } catch { toast("Não foi possível exportar neste ecrã."); }
  }

  /* ---------- CLIENTES ---------- */
  function clientsList() {
    const map = new Map();
    state.bookings.forEach((b) => {
      const key = b.phone.replace(/\D/g, "").slice(-9);
      const c = map.get(key) || { key, name: b.name, phone: b.phone, email: b.email, all: [] };
      c.all.push(b); map.set(key, c);
    });
    return [...map.values()].map((c) => {
      c.all.sort(byTime);
      const last = c.all[c.all.length - 1]; c.name = last.name; c.email = c.all.map((x) => x.email).filter(Boolean).pop() || "";
      c.visits = c.all.filter((b) => b.status === "concluida").length;
      c.next = c.all.filter((b) => b.day >= state.today && active(b) && !["concluida", "faltou"].includes(b.status)).length;
      c.noShow = c.all.filter((b) => b.status === "faltou").length;
      c.spent = sum(c.all.filter((b) => payInfo(b).k === "paid"));
      c.lastDay = [...c.all].reverse().find((b) => b.status === "concluida")?.day || "";
      return c;
    }).sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
  }
  function viewClients() {
    const q = state.cq.trim().toLowerCase();
    const rows = clientsList().filter((c) => !q || `${c.name} ${c.phone}`.toLowerCase().includes(q));
    const search = h("input", { type: "search", placeholder: "Procurar cliente por nome ou telefone", value: state.cq, "aria-label": "Procurar cliente" });
    search.addEventListener("input", () => { state.cq = search.value; const pos = search.selectionStart; render(); const s = $("#view input[type=search]"); if (s) { s.focus(); s.setSelectionRange(pos, pos); } });
    const table = h("div", { class: "tbl-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Cliente", "Telemóvel", "Visitas", "Próximas", "Faltas", "Última visita"].map((x) => h("th", { text: x })), h("th", { class: "r", text: "Gasto" }))),
      h("tbody", {}, rows.map((c) => h("tr", { class: "click", tabindex: "0", on: { click: () => openClient(c.key), keydown: (e) => { if (e.key === "Enter") openClient(c.key); } } },
        h("td", {}, h("b", { text: c.name })), h("td", { text: c.phone }), h("td", { text: String(c.visits) }), h("td", { text: String(c.next) }), h("td", { text: String(c.noShow) }),
        h("td", { text: c.lastDay ? fmtDay(c.lastDay) : "—" }), h("td", { class: "r", text: eur(c.spent) }))))));
    return [h("h2", { text: "Clientes" }), h("div", { class: "filters" }, search), h("p", { class: "muted small", text: `${rows.length} clientes (a partir do histórico de marcações)` }),
      rows.length ? table : h("p", { class: "empty", text: "Nenhum cliente encontrado." })];
  }
  function openClient(key) {
    const c = clientsList().find((x) => x.key === key); if (!c) return;
    openDlg([h("h2", { id: "dlgTitle" }, c.name),
      h("p", { class: "muted" }, c.phone, c.email ? ` · ${c.email}` : ""),
      h("p", {}, `${c.visits} visitas · ${c.noShow} faltas · ${eur(c.spent)} gastos`),
      h("div", { class: "acts" }, h("a", { class: "btn sm ghost", href: "tel:" + c.phone, text: "Ligar" }), h("a", { class: "btn sm ghost", href: "https://wa.me/" + phoneDigits(c.phone), target: "_blank", rel: "noopener", text: "WhatsApp" })),
      h("h3", { text: "Histórico" }), h("div", { class: "list" }, [...c.all].reverse().slice(0, 12).map((b) => bookingRow(b, true))),
      h("div", { class: "acts" }, h("button", { class: "btn sm ghost", type: "button", on: { click: closeDlg } }, "Fechar"))]);
  }

  /* ---------- FOLGAS E HORÁRIO ---------- */
  function viewFolgas() {
    const c = state.cfg;
    const hours = h("div", { class: "card" }, h("h3", { text: "Horário" }),
      h("ul", { class: "hist" }, [1, 2, 3, 4, 5, 6, 0].map((d) => h("li", {}, h("span", { text: WDL[d][0].toUpperCase() + WDL[d].slice(1) }), h("span", { text: c.hours[String(d)] ? `${c.hours[String(d)][0]} – ${c.hours[String(d)][1]}` : "Fechado" }))),
        c.breakTime ? h("li", {}, h("span", { text: "Pausa" }), h("span", { text: `${c.breakTime[0]} – ${c.breakTime[1]}` })) : null),
      h("p", { class: "muted small", text: IS_DEMO ? "Na demonstração o horário não pode ser alterado. No site real, edita-se em config.json." : "Para alterar o horário, edite o ficheiro config.json (ver README)." }));
    const svcs = h("div", { class: "card" }, h("h3", { text: "Serviços e preços" }),
      h("ul", { class: "hist" }, c.services.map((s) => h("li", {}, h("span", { text: `${s.name} · ${s.minutes} min` }), h("b", { text: eur(s.priceCents) })))),
      h("p", { class: "muted small", text: IS_DEMO ? "Na demonstração os serviços não podem ser alterados." : "Para alterar serviços e preços, edite o ficheiro config.json." }));

    const day = h("input", { type: "date", id: "bl-day", min: state.today, value: firstOpenDay(state.today) });
    const from = h("input", { type: "time", id: "bl-from", value: "13:00" }), to = h("input", { type: "time", id: "bl-to", value: "15:00" });
    const reason = h("input", { id: "bl-reason", maxlength: "80", placeholder: "Motivo (opcional)" });
    const whole = h("input", { type: "radio", name: "bl-kind", id: "bl-whole", checked: true }), partial = h("input", { type: "radio", name: "bl-kind", id: "bl-partial" });
    const times = h("div", { class: "inline" }, h("label", { for: "bl-from" }, "Das"), from, h("label", { for: "bl-to" }, "às"), to); times.hidden = true;
    const sync = () => { times.hidden = !partial.checked; }; whole.addEventListener("change", sync); partial.addEventListener("change", sync);
    const err = h("div", { class: "err", role: "alert" });
    const go = h("button", { class: "btn", type: "button" }, "Bloquear");
    go.addEventListener("click", async () => {
      err.textContent = ""; go.disabled = true;
      try {
        const r = await api("/api/admin/blocks", { method: "POST", body: JSON.stringify({ day: day.value, from: partial.checked ? from.value : null, to: partial.checked ? to.value : null, reason: reason.value }) });
        toast(r.conflicts ? `Bloqueado. Atenção: já há ${r.conflicts} marcação(ões) nesse período, trate delas à mão.` : "Bloqueio criado"); await loadAll(true);
      } catch (e) { err.textContent = e.message; }
      go.disabled = false;
    });
    const blocks = h("div", { class: "card" }, h("h3", { text: "Folgas e bloqueios" }),
      h("p", { class: "muted small", text: "Os clientes deixam de poder marcar nesse dia ou nessas horas." }),
      h("div", { class: "field" }, h("label", { for: "bl-day" }, "Dia"), day),
      h("div", { class: "seg" }, h("label", { for: "bl-whole" }, whole, "Dia inteiro"), h("label", { for: "bl-partial" }, partial, "Só algumas horas")), times,
      h("div", { class: "field" }, h("label", { for: "bl-reason" }, "Motivo"), reason), err, go,
      h("h3", { text: "Já marcados" }),
      state.blocks.length ? h("ul", { class: "hist" }, state.blocks.map((x) => h("li", {}, h("span", { text: `${fmtDay(x.day)} · ${x.from ? x.from + "–" + x.to : "dia inteiro"}${x.reason ? " · " + x.reason : ""}` }),
        h("button", { class: "btn sm ghost", type: "button", on: { click: () => removeBlock(x.id) } }, "Remover")))) : h("p", { class: "muted", text: "Sem bloqueios futuros." }));
    return [h("h2", { text: "Folgas e horário" }), h("div", { class: "two" }, blocks, h("div", { class: "grid" }, hours, svcs))];
  }

  /* ---------- estrutura ---------- */
  const TABS = [["hoje", "Hoje", viewHoje], ["calendario", "Calendário", viewCal], ["marcacoes", "Marcações", viewList], ["pagamentos", "Pagamentos", viewPay], ["clientes", "Clientes", viewClients], ["folgas", "Folgas e horário", viewFolgas]];
  function render() {
    const pend = state.bookings.filter((b) => b.status === "a_aguardar_pagamento" && b.day >= state.today).length;
    $("#tabs").replaceChildren(...TABS.map(([k, label]) => h("button", { class: "tab", type: "button", "aria-current": state.tab === k ? "page" : false, on: { click: () => { state.tab = k; render(); window.scrollTo(0, 0); } } },
      label, k === "pagamentos" && pend ? h("span", { class: "n", text: String(pend) }) : null)));
    const fn = TABS.find((t) => t[0] === state.tab)[2];
    view.replaceChildren(...fn());
  }
  async function loadAll(quiet) {
    try {
      if (!state.cfg) { state.cfg = await api("/api/config"); state.today = state.cfg.today; state.month = state.today.slice(0, 8) + "01"; state.day = state.today; }
      const from = addDays(state.today, -120);
      const [b, bl] = await Promise.all([api(`/api/admin/bookings?from=${from}`), api("/api/admin/blocks")]);
      state.bookings = b.bookings; state.blocks = bl.blocks;
      $("#updated").textContent = "Atualizado às " + new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
      render();
    } catch (e) {
      if (!quiet) view.replaceChildren(h("p", { class: "empty", text: e.status === 401 ? "Sem acesso." : "Não foi possível carregar: " + e.message }));
    }
  }
  $("#reload").addEventListener("click", () => loadAll(false));
  $("#newBooking").addEventListener("click", () => openNew(state.tab === "calendario" ? state.day : ""));
  setInterval(() => { const a = document.activeElement; if (!dlg.open && !(a && ["INPUT", "SELECT", "TEXTAREA"].includes(a.tagName))) loadAll(true); }, 60000);
  await loadAll(false);
})();
