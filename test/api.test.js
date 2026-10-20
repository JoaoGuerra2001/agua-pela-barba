"use strict";
// Testes da API contra um Postgres de TESTE (apaga as tabelas!). Correr com:
//   TEST_DATABASE_URL=postgres://utilizador@localhost:5432/apb_test npm test
// Nunca usa DATABASE_URL, para não tocar na base de dados real.
const test = require("node:test");
const assert = require("node:assert/strict");

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) { console.log("TEST_DATABASE_URL não definida: testes ignorados."); process.exit(0); }
process.env.DATABASE_URL = TEST_URL;
process.env.ADMIN_PASSWORD = "teste123";
delete process.env.STRIPE_SECRET_KEY;
const CONFIG = require("../config.json");
const { app, pool, ready } = require("../server");

let server, base;
test.before(async () => { await ready; await pool.query("TRUNCATE bookings, blocks"); await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
test.after(async () => { server.close(); await pool.end(); });

const call = (p, o = {}) => fetch(base + p, { ...o, headers: { "content-type": "application/json", ...(o.headers || {}) } });
const ADMIN = { authorization: "Basic " + Buffer.from("x:teste123").toString("base64") };
const post = (p, body, headers) => call(p, { method: "POST", body: JSON.stringify(body), headers });

function openDays(n) {
  const out = [];
  for (let i = 1; out.length < n && i <= CONFIG.daysAhead; i++) {
    const d = new Date(Date.now() + i * 864e5);
    if (CONFIG.hours[String(d.getUTCDay())]) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const [D1, D2, D3] = openDays(3);
const person = (extra) => ({ serviceId: "corte", day: D1, time: "10:00", name: "Teste", phone: "912345678", payMode: "later", ...extra });

test("config pública traz serviços e não expõe segredos", async () => {
  const r = await call("/api/config"); const c = await r.json();
  assert.equal(r.status, 200);
  assert.equal(c.services.length, CONFIG.services.length);
  assert.equal(c.onlinePayments, false);
  assert.ok(!JSON.stringify(c).includes("teste123"));
});

test("disponibilidade devolve horas e recusa dia fechado", async () => {
  const r = await call(`/api/availability?service=corte&day=${D1}`); const j = await r.json();
  assert.equal(r.status, 200); assert.ok(j.slots.some((s) => s.ok));
  const closed = new Date(Date.now() + 864e5 * (1 + [...Array(8).keys()].find((i) => !CONFIG.hours[String(new Date(Date.now() + 864e5 * (1 + i)).getUTCDay())])));
  const r2 = await call(`/api/availability?service=corte&day=${closed.toISOString().slice(0, 10)}`);
  assert.equal(r2.status, 400);
});

test("marcação criada, duplicada e sobreposta são tratadas", async () => {
  const a = await post("/api/bookings", person()); assert.equal(a.status, 201);
  const { booking, token } = await a.json(); assert.equal(booking.status, "confirmada");
  assert.equal((await post("/api/bookings", person())).status, 409);
  assert.equal((await post("/api/bookings", person({ serviceId: "combo", time: "09:30" }))).status, 409);
  const get = await call(`/api/bookings/${booking.id}?token=${token}`); assert.equal(get.status, 200);
  assert.equal((await call(`/api/bookings/${booking.id}?token=errado`)).status, 404);
});

test("validação de dados e pagamento online sem Stripe", async () => {
  assert.equal((await post("/api/bookings", person({ time: "11:00", phone: "12" }))).status, 400);
  assert.equal((await post("/api/bookings", person({ time: "11:00", name: "" }))).status, 400);
  assert.equal((await post("/api/bookings", person({ time: "11:00", serviceId: "xx" }))).status, 400);
  assert.equal((await post("/api/bookings", person({ time: "11:00", payMode: "now" }))).status, 409);
});

test("cliente cancela a sua marcação com o token certo", async () => {
  const a = await post("/api/bookings", person({ day: D2, time: "10:00" })); const { booking, token } = await a.json();
  assert.equal((await post(`/api/bookings/${booking.id}/cancel`, { token: "errado" })).status, 404);
  const c = await post(`/api/bookings/${booking.id}/cancel`, { token }); assert.equal(c.status, 200);
  assert.equal((await c.json()).booking.status, "cancelada");
  assert.equal((await post("/api/bookings", person({ day: D2, time: "10:00" }))).status, 201); // hora libertada
});

test("painel exige palavra-passe", async () => {
  assert.equal((await call("/api/admin/bookings")).status, 401);
  assert.equal((await call("/api/admin/blocks")).status, 401);
  assert.equal((await post("/api/admin/bookings", {})).status, 401);
  assert.equal((await call("/admin/")).status, 401);
  assert.equal((await call("/api/admin/bookings", { headers: { authorization: "Basic " + Buffer.from("x:errada").toString("base64") } })).status, 401);
  const r = await call("/api/admin/bookings?from=2020-01-01", { headers: ADMIN }); assert.equal(r.status, 200);
  assert.ok((await r.json()).bookings.length >= 1);
});

test("administrador muda estados e cria marcações manuais", async () => {
  const m = await post("/api/admin/bookings", person({ day: D3, time: "09:00", paid: true }), ADMIN);
  assert.equal(m.status, 201); const { booking } = await m.json(); assert.equal(booking.status, "paga");
  assert.equal((await post("/api/admin/bookings", person({ day: D3, time: "09:00" }), ADMIN)).status, 409);
  const s = await post(`/api/admin/bookings/${booking.id}/status`, { status: "concluida" }, ADMIN); assert.equal(s.status, 200);
  assert.equal((await post(`/api/admin/bookings/${booking.id}/status`, { status: "inventado" }, ADMIN)).status, 400);
});

test("bloqueios parciais e de dia inteiro afetam a disponibilidade", async () => {
  const p = await post("/api/admin/blocks", { day: D3, from: "15:00", to: "17:00", reason: "Teste" }, ADMIN); assert.equal(p.status, 201);
  const pb = (await p.json()).block;
  const av = await (await call(`/api/availability?service=corte&day=${D3}`)).json();
  assert.equal(av.slots.find((s) => s.time === "15:30").ok, false);
  assert.equal((await post("/api/admin/blocks", { day: D3, from: "17:00", to: "15:00" }, ADMIN)).status, 400);
  assert.equal((await call(`/api/admin/blocks/${pb.id}`, { method: "DELETE", headers: ADMIN })).status, 200);

  const f = await post("/api/admin/blocks", { day: D3, reason: "Folga" }, ADMIN); const fb = (await f.json()).block;
  assert.equal((await call(`/api/availability?service=corte&day=${D3}`)).status, 400);
  assert.ok((await (await call("/api/config")).json()).closedDays.includes(D3));
  await call(`/api/admin/blocks/${fb.id}`, { method: "DELETE", headers: ADMIN });
  assert.equal((await call(`/api/availability?service=corte&day=${D3}`)).status, 200);
});

test("cabeçalhos de segurança estão presentes", async () => {
  const r = await call("/"); const csp = r.headers.get("content-security-policy");
  assert.ok(csp && csp.includes("script-src 'self'") && !csp.includes("unsafe-inline"));
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("duas marcações em simultâneo para a mesma hora: só uma entra", async () => {
  const day = openDays(3)[2];
  const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => post("/api/admin/bookings", person({ day, time: "11:00", name: "Corrida " + i }), ADMIN)));
  const codes = rs.map((r) => r.status).sort();
  assert.deepEqual(codes, [201, 409, 409, 409, 409]);
});
