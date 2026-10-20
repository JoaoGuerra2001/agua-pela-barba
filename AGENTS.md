# Água pela Barba — instruções para agentes

Site de marcações em pt-PT para o cabeleireiro/barbearia "Água pela Barba" (Largo Sra. da Saúde, Fermentelos).
Escrever sempre em português de Portugal (textos, commits, comentários).

## Stack e estrutura
- Node >= 20, Express, better-sqlite3 (ficheiro em `DATA_DIR/bookings.db`), Stripe Checkout (cartão + MB WAY).
- `server.js` API + estáticos · `config.json` dados do negócio (horário, serviços, contactos, galeria, equipa)
- `public/` site do cliente (JS/CSS vanilla) · `admin/` painel (Basic Auth com `ADMIN_PASSWORD`)
- `demo/` demos em ficheiro único: `shim.js` simula o servidor; `node demo/build.js` regenera `demo/*.html`
- `test/api.test.js` testes da API

## Comandos
- `npm install` · `npm test` (tem de passar sempre) · `ADMIN_PASSWORD=xxx npm start` (porta 3000) · `npm run build:demo`

## Regras (não quebrar)
- CSP estrita: sem scripts nem estilos inline, sem `innerHTML` com dados do utilizador (usar `textContent`).
  Novas origens externas só se forem mesmo necessárias e com a CSP em `server.js` atualizada.
- Nunca guardar nem pedir dados de cartão: o pagamento é sempre no Stripe Checkout.
- Segredos só por variáveis de ambiente (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_PASSWORD`, `NOTIFY_WEBHOOK`). Nunca em ficheiros, commits ou no chat. `.env` e `data/` ficam no `.gitignore`.
- Fuso Europe/Lisbon. Marcação = verificação + inserção atómicas (transação). Manter as reservas temporárias (`HOLD_MINUTES`) para pagamentos online pendentes.
- Estados: confirmada, paga, a_aguardar_pagamento, cancelada, concluida, faltou.
- Quando mudares `public/` ou `admin/`, corre `npm run build:demo` para as demos ficarem iguais.
- Testar pagamentos só com chaves Stripe de teste (`sk_test_...`) e `stripe listen` para o webhook.
- Valores em `config.json` (horas, preços, telefone) são PROVISÓRIOS até o dono confirmar.
