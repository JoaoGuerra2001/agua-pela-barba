"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Pool, types } = require("pg");

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DATABASE_URL = process.env.DATABASE_URL || "";
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const NOTIFY_WEBHOOK = process.env.NOTIFY_WEBHOOK || "";
const HOLD_MINUTES = 30; // tempo que uma hora fica reservada à espera de pagamento (mínimo do Stripe)
const TZ = "Europe/Lisbon";

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(9).toString("base64url");
  console.warn(`[aviso] ADMIN_PASSWORD não definida. Palavra-passe temporária do painel: ${ADMIN_PASSWORD}`);
}

const stripe = STRIPE_KEY ? require("stripe")(STRIPE_KEY) : null;

if (!DATABASE_URL) { console.error("Falta a variável DATABASE_URL (ligação Postgres/Supabase). Veja o README."); process.exit(1); }
types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz -> texto ISO
const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(DATABASE_URL);
const pool = new Pool({ connectionString: DATABASE_URL, max: process.env.VERCEL ? 1 : 8, ssl: local ? false : { rejectUnauthorized: false } });
pool.on("error", (e) => console.warn("[base de dados]", e.message));
const q = async (text, params = [], c = pool) => (await c.query(text, params)).rows;
const one = async (text, params, c) => (await q(text, params, c))[0];
const ready = pool.query(fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf8"));
async function tx(fn) {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}

/* ---------- tempo (Europa/Lisboa) ---------- */
function lisbonNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: Number(g("hour")) * 60 + Number(g("minute")) };
}
const weekday = (ds) => new Date(ds + "T00:00:00Z").getUTCDay();
const addDays = (ds, n) => { const d = new Date(ds + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const pad = (n) => String(n).padStart(2, "0");
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const isTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/* ---------- disponibilidade ---------- */
const ACTIVE_SQL = `(status IN ('confirmada','paga') OR (status='a_aguardar_pagamento' AND expires_at > now()))`;

const activeBookings = (day, c) => q(`SELECT "time", minutes FROM bookings WHERE day = $1 AND ${ACTIVE_SQL}`, [day], c);
const blocksOn = (day, c) => q("SELECT * FROM blocks WHERE day = $1", [day], c);
async function dayError(day, c) {
  if (!isDate(day)) return "Data inválida.";
  const now = lisbonNow();
  if (day < now.date) return "Esse dia já passou.";
  if (day > addDays(now.date, CONFIG.daysAhead)) return `Só aceitamos marcações até ${CONFIG.daysAhead} dias à frente.`;
  if (!CONFIG.hours[String(weekday(day))]) return "Fechado nesse dia.";
  if ((await blocksOn(day, c)).some((b) => !b.from_time)) return "Fechado nesse dia.";
  return null;
}
async function slotsFor(day, minutes, c) {
  if (await dayError(day, c)) return [];
  const [open, close] = CONFIG.hours[String(weekday(day))];
  const busy = (await activeBookings(day, c)).map((b) => [toMin(b.time), toMin(b.time) + b.minutes]);
  if (CONFIG.breakTime) busy.push([toMin(CONFIG.breakTime[0]), toMin(CONFIG.breakTime[1])]);
  for (const bl of await blocksOn(day, c)) if (bl.from_time) busy.push([toMin(bl.from_time), toMin(bl.to_time)]);
  const now = lisbonNow();
  const out = [];
  for (let m = toMin(open); m + minutes <= toMin(close); m += CONFIG.slotMinutes) {
    let ok = !busy.some(([s, e]) => m < e && s < m + minutes);
    if (day === now.date && m < now.minutes + CONFIG.minLeadMinutes) ok = false;
    out.push({ time: fromMin(m), ok });
  }
  return out;
}
const findService = (id) => CONFIG.services.find((s) => s.id === id);

/* ---------- utilitários ---------- */
const newId = () => "APB-" + crypto.randomBytes(3).toString("hex").toUpperCase();
const newToken = () => crypto.randomBytes(16).toString("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const eur = (cents) => (cents / 100).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

function publicBooking(b) {
  return {
    id: b.id, day: b.day, time: b.time, minutes: b.minutes, service: b.service_name,
    priceCents: b.price_cents, name: b.name, payMode: b.pay_mode, status: b.status, expiresAt: b.expires_at,
  };
}
const getBooking = (id, c) => one("SELECT * FROM bookings WHERE id = $1", [String(id)], c);
async function getOwned(id, token) {
  const b = await getBooking(id);
  return b && token && safeEq(b.token, token) ? b : null;
}
async function notify(text) {
  if (!NOTIFY_WEBHOOK) return;
  try { await fetch(NOTIFY_WEBHOOK, { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: text }); }
  catch (e) { console.warn("[notificação falhou]", e.message); }
}
const describe = (b) => `${b.service_name}, ${b.day} às ${b.time} — ${b.name} (${b.phone})`;

/* rate limit simples em memória */
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path, now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: "Demasiados pedidos. Tente daqui a pouco." });
    arr.push(now); hits.set(key, arr); next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

async function insertBooking(day, time, svc, [id, token, name, phone, email, payMode, status, expires]) {
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [day]);
    const slot = (await slotsFor(day, svc.minutes, c)).find((s) => s.time === time);
    if (!slot || !slot.ok) return null;
    return one(`INSERT INTO bookings (id, token, day, "time", minutes, service_id, service_name, price_cents, name, phone, email, pay_mode, status, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [id, token, day, time, svc.minutes, svc.id, svc.name, svc.priceCents, name, phone, email, payMode, status, expires], c);
  });
}

/* ---------- app ---------- */
const app = express();
app.set("trust proxy", 1);
app.use("/api", (req, res, next) => ready.then(() => next(), next)); // garante o esquema antes do 1.º pedido (funções serverless)
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
      "img-src 'self' data:; connect-src 'self'; frame-src https://www.google.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  });
  next();
});

/* webhook do Stripe (corpo cru, antes do express.json) */
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(501).end();
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET); }
  catch { return res.status(400).send("assinatura inválida"); }
  const s = event.data.object;
  const id = s.client_reference_id || (s.metadata && s.metadata.bookingId);
  if (id && (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded")) {
    if (s.payment_status === "paid") await markPaid(id);
  } else if (id && (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed")) {
    await q("UPDATE bookings SET status='cancelada' WHERE id=$1 AND status='a_aguardar_pagamento'", [id]);
  }
  res.json({ received: true });
});
async function markPaid(id) {
  const b = await one("UPDATE bookings SET status='paga' WHERE id=$1 AND status='a_aguardar_pagamento' RETURNING *", [id]);
  if (b) notify(`Nova marcação PAGA: ${describe(b)}`);
}

app.use(express.json({ limit: "20kb" }));

/* ---------- API pública ---------- */
app.get("/api/config", async (req, res) => {
  const { name, tagline, address, mapsLink, phone, whatsapp, instagram, facebook, hours, breakTime, daysAhead, cancelHoursBefore, services, team, gallery } = CONFIG;
  res.json({ name, tagline, address, mapsLink, phone, whatsapp, instagram, facebook, hours, breakTime, daysAhead, cancelHoursBefore, services, team, gallery,
    today: lisbonNow().date, onlinePayments: Boolean(stripe),
    closedDays: (await q("SELECT DISTINCT day FROM blocks WHERE from_time IS NULL AND day >= $1", [lisbonNow().date])).map((r) => r.day),
    todayFull: !(await slotsFor(lisbonNow().date, Math.min(...CONFIG.services.map((s) => s.minutes)))).some((s) => s.ok) });
});

app.get("/api/availability", async (req, res) => {
  const svc = findService(req.query.service), day = req.query.day;
  if (!svc) return res.status(400).json({ error: "Serviço inválido." });
  const err = await dayError(day);
  if (err) return res.status(400).json({ error: err });
  res.json({ day, slots: await slotsFor(day, svc.minutes) });
});

app.post("/api/bookings", limit(12, 3600e3), async (req, res) => {
  const b = req.body || {};
  const svc = findService(b.serviceId);
  const name = clean(b.name, 80), phone = clean(b.phone, 20).replace(/[\s.\-()]/g, ""), email = clean(b.email, 120);
  const payMode = b.payMode === "now" ? "now" : "later";
  if (!svc) return res.status(400).json({ error: "Serviço inválido." });
  if (!isTime(b.time)) return res.status(400).json({ error: "Hora inválida." });
  const dErr = await dayError(b.day);
  if (dErr) return res.status(400).json({ error: dErr });
  if (name.length < 2) return res.status(400).json({ error: "Indique o seu nome." });
  if (!/^(\+351)?[239]\d{8}$/.test(phone)) return res.status(400).json({ error: "Indique um telemóvel português com 9 dígitos." });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Este email não parece correto." });
  if (payMode === "now" && !stripe) return res.status(409).json({ error: "O pagamento online ainda não está ativo. Escolha pagar no dia." });

  const id = newId(), token = newToken();
  const expires = payMode === "now" ? new Date(Date.now() + HOLD_MINUTES * 60e3).toISOString() : null;
  const status = payMode === "now" ? "a_aguardar_pagamento" : "confirmada";

  // verificação + inserção atómicas: trinco por dia dentro da transação
  const row = await insertBooking(b.day, b.time, svc, [id, token, name, phone, email, payMode, status, expires]);
  if (!row) return res.status(409).json({ error: "Essa hora acabou de ser ocupada. Escolha outra." });

  if (payMode === "later") {
    notify(`Nova marcação (paga no dia): ${describe(row)}`);
    return res.status(201).json({ booking: publicBooking(row), token });
  }
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: id,
      metadata: { bookingId: id },
      customer_email: email || undefined,
      line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: svc.priceCents,
        product_data: { name: `${svc.name} — ${CONFIG.name}`, description: `${b.day} às ${b.time}` } } }],
      expires_at: Math.floor(Date.now() / 1000) + HOLD_MINUTES * 60,
      success_url: `${BASE_URL}/?pago=${id}&t=${token}`,
      cancel_url: `${BASE_URL}/?cancelado=${id}&t=${token}`,
      locale: "pt",
    });
    await q("UPDATE bookings SET stripe_session=$1 WHERE id=$2", [session.id, id]);
    res.status(201).json({ booking: publicBooking(row), token, checkoutUrl: session.url });
  } catch (e) {
    console.error("[stripe]", e.message);
    await q("UPDATE bookings SET status='cancelada' WHERE id=$1", [id]);
    res.status(502).json({ error: "Não foi possível abrir o pagamento. Tente outra vez ou escolha pagar no dia." });
  }
});

app.get("/api/bookings/:id", async (req, res) => {
  let b = await getOwned(req.params.id, req.query.token);
  if (!b) return res.status(404).json({ error: "Marcação não encontrada." });
  if (b.status === "a_aguardar_pagamento" && stripe && b.stripe_session) {
    try {
      const s = await stripe.checkout.sessions.retrieve(b.stripe_session);
      if (s.payment_status === "paid") { await markPaid(b.id); b = await getBooking(b.id); }
    } catch (e) { console.warn("[stripe retrieve]", e.message); }
  }
  res.json({ booking: publicBooking(b) });
});

app.post("/api/bookings/:id/cancel", async (req, res) => {
  const b = await getOwned(req.params.id, req.body && req.body.token);
  if (!b) return res.status(404).json({ error: "Marcação não encontrada." });
  if (b.status === "cancelada") return res.json({ booking: publicBooking(b) });
  if (b.status === "paga") return res.status(409).json({ error: "Esta marcação já está paga. Para cancelar e receber o reembolso, contacte a barbearia." });
  if (b.status === "a_aguardar_pagamento") {
    await q("UPDATE bookings SET status='cancelada' WHERE id=$1", [b.id]);
  } else {
    const now = lisbonNow();
    const diff = (Date.parse(b.day + "T00:00:00Z") - Date.parse(now.date + "T00:00:00Z")) / 60e3 + toMin(b.time) - now.minutes;
    if (diff < CONFIG.cancelHoursBefore * 60) return res.status(409).json({ error: `Só é possível cancelar até ${CONFIG.cancelHoursBefore} horas antes. Contacte a barbearia.` });
    await q("UPDATE bookings SET status='cancelada' WHERE id=$1", [b.id]);
    notify(`Marcação CANCELADA pelo cliente: ${describe(b)}`);
  }
  res.json({ booking: publicBooking(await getBooking(b.id)) });
});

/* ---------- painel da barbearia ---------- */
function adminAuth(req, res, next) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Basic ")) {
    const [, pass = ""] = Buffer.from(h.slice(6), "base64").toString().split(/:(.*)/s);
    if (safeEq(pass, ADMIN_PASSWORD)) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Painel Água pela Barba", charset="UTF-8"').status(401).send("Autenticação necessária.");
}
app.use("/api/admin", limit(300, 3600e3), adminAuth);
app.use("/admin", adminAuth, express.static(path.join(__dirname, "admin"), { index: "admin.html" }));

app.get("/api/admin/bookings", async (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : lisbonNow().date;
  const to = isDate(req.query.to) ? req.query.to : "9999-12-31";
  const rows = await q('SELECT * FROM bookings WHERE day >= $1 AND day <= $2 ORDER BY day, "time"', [from, to]);
  const nowIso = new Date().toISOString();
  res.json({ bookings: rows
    .filter((b) => !(b.status === "a_aguardar_pagamento" && b.expires_at <= nowIso))
    .map((b) => ({ ...publicBooking(b), phone: b.phone, email: b.email, createdAt: b.created_at })) });
});
app.post("/api/admin/bookings/:id/status", async (req, res) => {
  const allowed = ["confirmada", "paga", "cancelada", "concluida", "faltou"];
  const status = req.body && req.body.status;
  if (!allowed.includes(status)) return res.status(400).json({ error: "Estado inválido." });
  const r = await pool.query("UPDATE bookings SET status=$1, expires_at=NULL WHERE id=$2", [status, req.params.id]);
  res.status(r.rowCount ? 200 : 404).json({ ok: Boolean(r.rowCount) });
});

/* marcação feita pelo administrador (telefone, balcão) */
app.post("/api/admin/bookings", async (req, res) => {
  const b = req.body || {};
  const svc = findService(b.serviceId);
  const name = clean(b.name, 80), phone = clean(b.phone, 20).replace(/[\s.\-()]/g, ""), email = clean(b.email, 120);
  if (!svc) return res.status(400).json({ error: "Serviço inválido." });
  if (!isTime(b.time)) return res.status(400).json({ error: "Hora inválida." });
  const dErr = await dayError(b.day);
  if (dErr) return res.status(400).json({ error: dErr });
  if (name.length < 2) return res.status(400).json({ error: "Indique o nome do cliente." });
  if (!/^(\+351)?[239]\d{8}$/.test(phone)) return res.status(400).json({ error: "Indique um telemóvel português com 9 dígitos." });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Este email não parece correto." });
  const id = newId(), token = newToken(), status = b.paid ? "paga" : "confirmada";
  const row = await insertBooking(b.day, b.time, svc, [id, token, name, phone, email, "later", status, null]);
  if (!row) return res.status(409).json({ error: "Essa hora já está ocupada ou bloqueada. Escolha outra." });
  res.status(201).json({ booking: publicBooking(row) });
});

/* folgas e bloqueios */
app.get("/api/admin/blocks", async (req, res) => {
  const rows = await q("SELECT * FROM blocks WHERE day >= $1 ORDER BY day, from_time", [lisbonNow().date]);
  res.json({ blocks: rows.map((r) => ({ id: r.id, day: r.day, from: r.from_time, to: r.to_time, reason: r.reason })) });
});
app.post("/api/admin/blocks", async (req, res) => {
  const b = req.body || {};
  const day = b.day, from = b.from || null, to = b.to || null, reason = clean(b.reason, 80);
  if (!isDate(day) || day < lisbonNow().date) return res.status(400).json({ error: "Escolha um dia a partir de hoje." });
  if (Boolean(from) !== Boolean(to)) return res.status(400).json({ error: "Indique a hora de início e de fim." });
  if (from && (!isTime(from) || !isTime(to) || toMin(from) >= toMin(to))) return res.status(400).json({ error: "A hora de fim tem de ser depois da de início." });
  const id = "BLK-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  await q("INSERT INTO blocks (id, day, from_time, to_time, reason) VALUES ($1,$2,$3,$4,$5)", [id, day, from, to, reason]);
  const conflicts = (await activeBookings(day)).filter((x) => !from || (toMin(x.time) < toMin(to) && toMin(from) < toMin(x.time) + x.minutes)).length;
  res.status(201).json({ block: { id, day, from, to, reason }, conflicts });
});
app.delete("/api/admin/blocks/:id", async (req, res) => {
  const r = await pool.query("DELETE FROM blocks WHERE id=$1", [req.params.id]);
  res.status(r.rowCount ? 200 : 404).json({ ok: Boolean(r.rowCount) });
});

/* ---------- ficheiros estáticos ---------- */
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: "1h" }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => {
  console.error("[erro]", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Ocorreu um erro. Tente outra vez daqui a pouco." });
});

if (require.main === module) {
  ready.then(() => app.listen(PORT, () => console.log(`Água pela Barba em ${BASE_URL} (pagamentos online: ${stripe ? "ativos" : "desativados"})`)))
    .catch((e) => { console.error("Não consegui ligar à base de dados:", e.message); process.exit(1); });
}
module.exports = app; // o Vercel usa a exportação por defeito
Object.assign(module.exports, { app, pool, ready });
