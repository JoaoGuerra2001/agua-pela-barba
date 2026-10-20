"use strict";
// Cópia diária dos dados para o Vercel Blob (privado). Ao ler a base de dados, também a mantém "ativa" no Supabase.
const KEEP = 14; // quantas cópias diárias guardar

async function snapshot(q) {
  const bookings = await q("SELECT * FROM bookings ORDER BY day, \"time\"");
  const blocks = await q("SELECT * FROM blocks ORDER BY day");
  return { version: 1, createdAt: new Date().toISOString(), bookings, blocks };
}

async function saveSnapshot(snap) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Falta BLOB_READ_WRITE_TOKEN (ligue um Vercel Blob ao projeto).");
  const { put, list, del } = require("@vercel/blob");
  const name = `backups/${snap.createdAt.slice(0, 10)}.json`;
  await put(name, JSON.stringify(snap), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
  const all = (await list({ prefix: "backups/" })).blobs.sort((a, b) => a.pathname.localeCompare(b.pathname));
  const old = all.slice(0, Math.max(0, all.length - KEEP));
  if (old.length) await del(old.map((b) => b.url));
  return { name, kept: Math.min(all.length, KEEP) };
}

async function latestSnapshot() {
  const { list, get } = require("@vercel/blob");
  const all = (await list({ prefix: "backups/" })).blobs.sort((a, b) => b.pathname.localeCompare(a.pathname));
  if (!all.length) return null;
  const r = await get(all[0].pathname, { access: "private" });
  return JSON.parse(await new Response(r.stream).text());
}

module.exports = { snapshot, saveSnapshot, latestSnapshot, KEEP };
