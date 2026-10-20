# Água pela Barba — instruções para agentes

Site de marcações em pt-PT para o cabeleireiro/barbearia "Água pela Barba" (Largo Sra. da Saúde, Fermentelos).
Escrever sempre em português de Portugal (textos, commits, comentários).

## Stack e estrutura
- Node >= 20, Express, `pg` + Postgres no Supabase (projeto `agua-pela-barba`, esquema em `db/schema.sql`, variável `DATABASE_URL`), Stripe Checkout (cartão + MB WAY).
- `server.js` API + estáticos · `config.json` dados do negócio (horário, serviços, contactos, galeria, equipa)
- `public/` site do cliente (JS/CSS vanilla) · `admin/` painel (Basic Auth com `ADMIN_PASSWORD`)
- `demo/` demos em ficheiro único: `shim.js` simula o servidor; `node demo/build.js` regenera `demo/*.html`
- `test/api.test.js` testes da API (precisam de um Postgres de teste)

## Alojamento
- Vercel (Express como função: `module.exports = app` em `server.js`, `vercel.json`). `DATABASE_URL` = Transaction pooler do Supabase (porta 6543). Sem disco nem processos em segundo plano.
- O limite de pedidos (`limit()`) é em memória, por instância: no Vercel é só uma proteção fraca.

## Comandos
- `npm install` · `TEST_DATABASE_URL=postgres://... npm test` (tem de passar sempre; apaga as tabelas, usar só uma base de teste, nunca a real) · `DATABASE_URL=... ADMIN_PASSWORD=xxx npm start` (porta 3000) · `npm run build:demo`

## Regras (não quebrar)
- CSP estrita: sem scripts nem estilos inline, sem `innerHTML` com dados do utilizador (usar `textContent`).
  Novas origens externas só se forem mesmo necessárias e com a CSP em `server.js` atualizada.
- Nunca guardar nem pedir dados de cartão: o pagamento é sempre no Stripe Checkout.
- Segredos só por variáveis de ambiente (`DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_PASSWORD`, `NOTIFY_WEBHOOK`). Nunca em ficheiros, commits ou no chat. `.env` fica no `.gitignore`.
- Fuso Europe/Lisbon. Marcação = verificação + inserção atómicas (transação com `pg_advisory_xact_lock` por dia). Manter as reservas temporárias (`HOLD_MINUTES`) para pagamentos online pendentes.
- Estados: confirmada, paga, a_aguardar_pagamento, cancelada, concluida, faltou.
- Quando mudares `public/` ou `admin/`, corre `npm run build:demo` para as demos ficarem iguais.
- Testar pagamentos só com chaves Stripe de teste (`sk_test_...`) e `stripe listen` para o webhook.
- Valores em `config.json` (horas, preços, telefone) são PROVISÓRIOS até o dono confirmar.
