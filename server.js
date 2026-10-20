"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const Database = require("better-sqlite3");

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
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

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "bookings.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  day TEXT NOT NULL,
  time TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  pay_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  stripe_session TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_day ON bookings(day);
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  from_time TEXT,
  to_time TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocks_day ON blocks(day);
`);

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
const ACTIVE_SQL = `(status IN ('confirmada','paga') OR (status='a_aguardar_pagamento' AND expires_at > ?))`;

function activeBookings(day) {
  return db.prepare(`SELECT time, minutes FROM bookings WHERE day = ? AND ${ACTIVE_SQL}`).all(day, new Date().toISOString());
}
function blocksOn(day) { return db.prepare("SELECT * FROM blocks WHERE day = ?").all(day); }
function dayError(day) {
  if (!isDate(day)) return "Data inválida.";
  const now = lisbonNow();
  if (day < now.date) return "Esse dia já passou.";
  if (day > addDays(now.date, CONFIG.daysAhead)) return `Só aceitamos marcações até ${CONFIG.daysAhead} dias à frente.`;
  if (!CONFIG.hours[String(weekday(day))]) return "Fechado nesse dia.";
  if (blocksOn(day).some((b) => !b.from_time)) return "Fechado nesse dia.";
  return null;
}
function slotsFor(day, minutes) {
  if (dayError(day)) return [];
  const [open, close] = CONFIG.hours[String(weekday(day))];
  const busy = activeBookings(day).map((b) => [toMin(b.time), toMin(b.time) + b.minutes]);
  if (CONFIG.breakTime) busy.push([toMin(CONFIG.breakTime[0]), toMin(CONFIG.breakTime[1])]);
  for (const bl of blocksOn(day)) if (bl.from_time) busy.push([toMin(bl.from_time), toMin(bl.to_time)]);
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
function getOwned(id, token) {
  const b = db.prepare("SELECT * FROM bookings WHERE id = ?").get(String(id));
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

/* ---------- app ---------- */
const app = express();
app.set("trust proxy", 1);
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
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(501).end();
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET); }
  catch { return res.status(400).send("assinatura inválida"); }
  const s = event.data.object;
  const id = s.client_reference_id || (s.metadata && s.metadata.bookingId);
  if (id && (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded")) {
    if (s.payment_status === "paid") markPaid(id);
  } else if (id && (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed")) {
    db.prepare("UPDATE bookings SET status='cancelada' WHERE id=? AND status='a_aguardar_pagamento'").run(id);
  }
  res.json({ received: true });
});
function markPaid(id) {
  const r = db.prepare("UPDATE bookings SET status='paga' WHERE id=? AND status IN ('a_aguardar_pagamento')").run(id);
  if (r.changes) {
    const b = db.prepare("SELECT * FROM bookings WHERE id=?").get(id);
    notify(`Nova marcação PAGA: ${describe(b)}`);
  }
}

app.use(express.json({ limit: "20kb" }));

/* ---------- API pública ---------- */
app.get("/api/config", (req, res) => {
  const { name, tagline, address, mapsLink, phone, whatsapp, instagram, facebook, hours, breakTime, daysAhead, cancelHoursBefore, services, team, gallery } = CONFIG;
  res.json({ name, tagline, address, mapsLink, phone, whatsapp, instagram, facebook, hours, breakTime, daysAhead, cancelHoursBefore, services, team, gallery,
    today: lisbonNow().date, onlinePayments: Boolean(stripe),
    closedDays: db.prepare("SELECT DISTINCT day FROM blocks WHERE from_time IS NULL AND day >= ?").all(lisbonNow().date).map((r) => r.day),
    todayFull: !slotsFor(lisbonNow().date, Math.min(...CONFIG.services.map((s) => s.minutes))).some((s) => s.ok) });
});

app.get("/api/availability", (req, res) => {
  const svc = findService(req.query.service), day = req.query.day;
  if (!svc) return res.status(400).json({ error: "Serviço inválido." });
  const err = dayError(day);
  if (err) return res.status(400).json({ error: err });
  res.json({ day, slots: slotsFor(day, svc.minutes) });
});

app.post("/api/bookings", limit(12, 3600e3), async (req, res) => {
  const b = req.body || {};
  const svc = findService(b.serviceId);
  const name = clean(b.name, 80), phone = clean(b.phone, 20).replace(/[\s.\-()]/g, ""), email = clean(b.email, 120);
  const payMode = b.payMode === "now" ? "now" : "later";
  if (!svc) return res.status(400).json({ error: "Serviço inválido." });
  if (!isTime(b.time)) return res.status(400).json({ error: "Hora inválida." });
  const dErr = dayError(b.day);
  if (dErr) return res.status(400).json({ error: dErr });
  if (name.length < 2) return res.status(400).json({ error: "Indique o seu nome." });
  if (!/^(\+351)?[239]\d{8}$/.test(phone)) return res.status(400).json({ error: "Indique um telemóvel português com 9 dígitos." });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Este email não parece correto." });
  if (payMode === "now" && !stripe) return res.status(409).json({ error: "O pagamento online ainda não está ativo. Escolha pagar no dia." });

  const id = newId(), token = newToken();
  const nowIso = new Date().toISOString();
  const expires = payMode === "now" ? new Date(Date.now() + HOLD_MINUTES * 60e3).toISOString() : null;
  const status = payMode === "now" ? "a_aguardar_pagamento" : "confirmada";

  // verificação + inserção atómicas (better-sqlite3 é síncrono)
  const insert = db.transaction(() => {
    const slot = slotsFor(b.day, svc.minutes).find((s) => s.time === b.time);
    if (!slot || !slot.ok) return false;
    db.prepare(`INSERT INTO bookings (id, token, day, time, minutes, service_id, service_name, price_cents, name, phone, email, pay_mode, status, created_at, expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, token, b.day, b.time, svc.minutes, svc.id, svc.name, svc.priceCents, name, phone, email, payMode, status, nowIso, expires);
    return true;
  });
  if (!insert()) return res.status(409).json({ error: "Essa hora acabou de ser ocupada. Escolha outra." });

  const row = db.prepare("SELECT * FROM bookings WHERE id=?").get(id);
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
    db.prepare("UPDATE bookings SET stripe_session=? WHERE id=?").run(session.id, id);
    res.status(201).json({ booking: publicBooking(row), token, checkoutUrl: session.url });
  } catch (e) {
    console.error("[stripe]", e.message);
    db.prepare("UPDATE bookings SET status='cancelada' WHERE id=?").run(id);
    res.status(502).json({ error: "Não foi possível abrir o pagamento. Tente outra vez ou escolha pagar no dia." });
  }
});

app.get("/api/bookings/:id", async (req, res) => {
  let b = getOwned(req.params.id, req.query.token);
  if (!b) return res.status(404).json({ error: "Marcação não encontrada." });
  if (b.status === "a_aguardar_pagamento" && stripe && b.stripe_session) {
    try {
      const s = await stripe.checkout.sessions.retrieve(b.stripe_session);
      if (s.payment_status === "paid") { markPaid(b.id); b = db.prepare("SELECT * FROM bookings WHERE id=?").get(b.id); }
    } catch (e) { console.warn("[stripe retrieve]", e.message); }
  }
  res.json({ booking: publicBooking(b) });
});

app.post("/api/bookings/:id/cancel", (req, res) => {
  const b = getOwned(req.params.id, req.body && req.body.token);
  if (!b) return res.status(404).json({ error: "Marcação não encontrada." });
  if (b.status === "cancelada") return res.json({ booking: publicBooking(b) });
  if (b.status === "paga") return res.status(409).json({ error: "Esta marcação já está paga. Para cancelar e receber o reembolso, contacte a barbearia." });
  if (b.status === "a_aguardar_pagamento") {
    db.prepare("UPDATE bookings SET status='cancelada' WHERE id=?").run(b.id);
  } else {
    const now = lisbonNow();
    const diff = (Date.parse(b.day + "T00:00:00Z") - Date.parse(now.date + "T00:00:00Z")) / 60e3 + toMin(b.time) - now.minutes;
    if (diff < CONFIG.cancelHoursBefore * 60) return res.status(409).json({ error: `Só é possível cancelar até ${CONFIG.cancelHoursBefore} horas antes. Contacte a barbearia.` });
    db.prepare("UPDATE bookings SET status='cancelada' WHERE id=?").run(b.id);
    notify(`Marcação CANCELADA pelo cliente: ${describe(b)}`);
  }
  res.json({ booking: publicBooking(db.prepare("SELECT * FROM bookings WHERE id=?").get(b.id)) });
});

app.get("/api/bookings/:id/calendar.ics", (req, res) => {
  const b = getOwned(req.params.id, req.query.token);
  if (!b) return res.status(404).end();
  const stamp = (day, min) => day.replace(/-/g, "") + "T" + pad(Math.floor(min / 60)) + pad(min % 60) + "00";
  const esc = (s) => s.replace(/[\\;,]/g, (c) => "\\" + c);
  // hora "flutuante" (sem fuso): o calendário do cliente interpreta-a na hora local, que é a de Portugal
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Agua pela Barba//PT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${b.id}@agua-pela-barba`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART:${stamp(b.day, toMin(b.time))}`, `DTEND:${stamp(b.day, toMin(b.time) + b.minutes)}`,
    `SUMMARY:${esc(b.service_name + " — " + CONFIG.name)}`, `LOCATION:${esc(CONFIG.address)}`, `DESCRIPTION:${esc("Marcação " + b.id)}`,
    "BEGIN:VALARM", "TRIGGER:-PT60M", "ACTION:DISPLAY", "DESCRIPTION:Marcação na barbearia", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n") + "\r\n";
  res.set({ "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="marcacao-${b.id}.ics"` }).send(ics);
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

app.get("/api/admin/bookings", (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : lisbonNow().date;
  const to = isDate(req.query.to) ? req.query.to : "9999-12-31";
  const rows = db.prepare("SELECT * FROM bookings WHERE day >= ? AND day <= ? ORDER BY day, time").all(from, to);
  const nowIso = new Date().toISOString();
  res.json({ bookings: rows
    .filter((b) => !(b.status === "a_aguardar_pagamento" && b.expires_at <= nowIso))
    .map((b) => ({ ...publicBooking(b), phone: b.phone, email: b.email, createdAt: b.created_at })) });
});
app.post("/api/admin/bookings/:id/status", (req, res) => {
  const allowed = ["confirmada", "paga", "cancelada", "concluida", "faltou"];
  const status = req.body && req.body.status;
  if (!allowed.includes(status)) return res.status(400).json({ error: "Estado inválido." });
  const r = db.prepare("UPDATE bookings SET status=?, expires_at=NULL WHERE id=?").run(status, req.params.id);
  res.status(r.changes ? 200 : 404).json({ ok: Boolean(r.changes) });
});

/* marcação feita pelo administrador (telefone, balcão) */
app.post("/api/admin/bookings", (req, res) => {
  const b = req.body || {};
  const svc = findService(b.serviceId);
  const name = clean(b.name, 80), phone = clean(b.phone, 20).replace(/[\s.\-()]/g, ""), email = clean(b.email, 120);
  if (!svc) return res.status(400).json({ error: "Serviço inválido." });
  if (!isTime(b.time)) return res.status(400).json({ error: "Hora inválida." });
  const dErr = dayError(b.day);
  if (dErr) return res.status(400).json({ error: dErr });
  if (name.length < 2) return res.status(400).json({ error: "Indique o nome do cliente." });
  if (!/^(\+351)?[239]\d{8}$/.test(phone)) return res.status(400).json({ error: "Indique um telemóvel português com 9 dígitos." });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Este email não parece correto." });
  const id = newId(), token = newToken(), status = b.paid ? "paga" : "confirmada";
  const insert = db.transaction(() => {
    const slot = slotsFor(b.day, svc.minutes).find((s) => s.time === b.time);
    if (!slot || !slot.ok) return false;
    db.prepare(`INSERT INTO bookings (id, token, day, time, minutes, service_id, service_name, price_cents, name, phone, email, pay_mode, status, created_at, expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(id, token, b.day, b.time, svc.minutes, svc.id, svc.name, svc.priceCents, name, phone, email, "later", status, new Date().toISOString());
    return true;
  });
  if (!insert()) return res.status(409).json({ error: "Essa hora já está ocupada ou bloqueada. Escolha outra." });
  res.status(201).json({ booking: publicBooking(db.prepare("SELECT * FROM bookings WHERE id=?").get(id)) });
});

/* folgas e bloqueios */
app.get("/api/admin/blocks", (req, res) => {
  const rows = db.prepare("SELECT * FROM blocks WHERE day >= ? ORDER BY day, from_time").all(lisbonNow().date);
  res.json({ blocks: rows.map((r) => ({ id: r.id, day: r.day, from: r.from_time, to: r.to_time, reason: r.reason })) });
});
app.post("/api/admin/blocks", (req, res) => {
  const b = req.body || {};
  const day = b.day, from = b.from || null, to = b.to || null, reason = clean(b.reason, 80);
  if (!isDate(day) || day < lisbonNow().date) return res.status(400).json({ error: "Escolha um dia a partir de hoje." });
  if (Boolean(from) !== Boolean(to)) return res.status(400).json({ error: "Indique a hora de início e de fim." });
  if (from && (!isTime(from) || !isTime(to) || toMin(from) >= toMin(to))) return res.status(400).json({ error: "A hora de fim tem de ser depois da de início." });
  const id = "BLK-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  db.prepare("INSERT INTO blocks (id, day, from_time, to_time, reason, created_at) VALUES (?,?,?,?,?,?)").run(id, day, from, to, reason, new Date().toISOString());
  const conflicts = activeBookings(day).filter((x) => !from || (toMin(x.time) < toMin(to) && toMin(from) < toMin(x.time) + x.minutes)).length;
  res.status(201).json({ block: { id, day, from, to, reason }, conflicts });
});
app.delete("/api/admin/blocks/:id", (req, res) => {
  const r = db.prepare("DELETE FROM blocks WHERE id=?").run(req.params.id);
  res.status(r.changes ? 200 : 404).json({ ok: Boolean(r.changes) });
});

/* ---------- ficheiros estáticos ---------- */
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: "1h" }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "index.html")));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Água pela Barba em ${BASE_URL} (pagamentos online: ${stripe ? "ativos" : "desativados"})`));
}
module.exports = { app, db };
