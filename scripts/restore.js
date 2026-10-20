"use strict";
// Repõe a última cópia diária numa base de dados (por exemplo num projeto Supabase novo).
// Uso: DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... node scripts/restore.js
// Não apaga nada: só acrescenta o que falta (ON CONFLICT DO NOTHING).
const { Pool } = require("pg");
const fs = require("fs"), path = require("path");
const { latestSnapshot } = require("../backup");

(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL.");
  const snap = await latestSnapshot();
  if (!snap) throw new Error("Não há cópias guardadas.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /@(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  await pool.query(fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8"));
  let nb = 0, nk = 0;
  for (const b of snap.bookings) {
    const r = await pool.query(`INSERT INTO bookings (id, token, day, "time", minutes, service_id, service_name, price_cents, name, phone, email, pay_mode, status, stripe_session, created_at, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`,
      [b.id, b.token, b.day, b.time, b.minutes, b.service_id, b.service_name, b.price_cents, b.name, b.phone, b.email, b.pay_mode, b.status, b.stripe_session, b.created_at, b.expires_at]);
    nb += r.rowCount;
  }
  for (const k of snap.blocks) {
    const r = await pool.query("INSERT INTO blocks (id, day, from_time, to_time, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
      [k.id, k.day, k.from_time, k.to_time, k.reason, k.created_at]);
    nk += r.rowCount;
  }
  console.log(`Cópia de ${snap.createdAt}: repostas ${nb} marcações e ${nk} bloqueios.`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
