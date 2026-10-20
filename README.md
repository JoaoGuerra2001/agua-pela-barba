# Água pela Barba — site com marcações

Site da barbearia com marcação de hora, pagamento no dia ou online (MB WAY / cartão) e painel para ver as marcações.

## 0. Demonstrações (sem servidor)
Em `demo/` há dois ficheiros para abrir no navegador: `demo-site-cliente.html` (o que o cliente vê) e `demo-painel-admin.html` (o painel do administrador, já com histórico de exemplo). Partilham as marcações e as folgas no mesmo navegador, por isso uma marcação feita no site aparece no painel e um dia bloqueado no painel deixa de poder ser escolhido no site. Nada é cobrado e os dados são de exemplo. Para os regenerar depois de mudar o site: `node demo/build.js`.

## 1. Correr no computador
```
npm install
ADMIN_PASSWORD=qualquer-coisa npm start
```
Site: http://localhost:3000 · Painel: http://localhost:3000/admin (a palavra-passe é `ADMIN_PASSWORD`).

## 2. O que tem de editar (`config.json`)
Os valores atuais são **exemplos**; só o nome e a morada vêm do Google Maps.
- `phone`, `whatsapp`, `instagram`, `facebook`
- `hours`: horário por dia (0 = domingo; `null` = fechado) e `breakTime`
- `services`: nome, duração (`minutes`), preço (`priceCents`, em cêntimos) e descrição
- `team` e `gallery` (opcionais): ponha fotos em `public/img/` e liste-as, por exemplo
  `"team": [{"name":"Nome","role":"Barbeiro","photo":"img/nome.jpg"}]`,
  `"gallery": [{"src":"img/corte1.jpg","alt":"Degradê","caption":"Degradê"}]`.
  Sem foto, a equipa mostra as iniciais; a galeria abre cada foto em ponto grande.
  As secções só aparecem se tiverem conteúdo.

## 3. Publicar
Precisa de um serviço que corra Node.js **com disco persistente** (a base de dados é um ficheiro SQLite). Por exemplo Render, Railway ou Fly.io.
1. Envie esta pasta para um repositório e crie um serviço Node (`npm install` / `npm start`).
2. Defina as variáveis de `.env.example`. `BASE_URL` é o endereço público final (com https).
3. Aponte `DATA_DIR` para o disco persistente (por exemplo `/data`), senão as marcações perdem-se a cada atualização.
4. Ligue o domínio da barbearia.

## 4. Ativar “Pagar agora” (Stripe)
1. Crie conta em stripe.com e, em Definições › Métodos de pagamento, ative **cartão** e **MB WAY**.
2. Copie a chave secreta para `STRIPE_SECRET_KEY`.
3. Em Developers › Webhooks, crie um endpoint `https://o-seu-dominio.pt/api/stripe/webhook` com os eventos
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` e `checkout.session.expired`.
   Copie o segredo para `STRIPE_WEBHOOK_SECRET`.
4. Faça um pagamento de teste com as chaves de teste antes de passar às chaves reais.

Enquanto não houver chave, o site continua a funcionar e a opção “Pagar agora” aparece como indisponível.
Quem escolhe pagar online fica com a hora reservada 30 minutos; se não pagar, a hora volta a ficar livre.

## 5. Dia a dia (painel em /admin)
- **Hoje:** marcações do dia, quanto falta receber no balcão, quanto já está pago, a próxima marcação e os próximos 7 dias. Se hoje estiver fechado, mostra o próximo dia de abertura.
- **Calendário:** vista de mês com as marcações em cada dia. Clicar numa marcação abre o detalhe (contacto, serviço, pagamento, ações); clicar no dia mostra a agenda desse dia, onde se pode criar uma marcação ou marcar folga.
- **Marcações:** lista com pesquisa e filtros por período e estado.
- **Pagamentos:** recebido online e no balcão, por receber, a aguardar pagamento, total por serviço e exportação para CSV (Excel).
- **Clientes:** histórico por cliente (visitas, faltas, gasto), com Ligar e WhatsApp.
- **Folgas e horário:** bloquear um dia inteiro ou umas horas (os clientes deixam de poder marcar); ver horário e serviços.
- **Nova marcação:** para quem marca por telefone ou no balcão.
- `NOTIFY_WEBHOOK` envia uma mensagem por cada marcação nova (por exemplo para uma app ntfy no telemóvel).
- Cancelamentos pelo cliente: até `cancelHoursBefore` horas antes, só se ainda não pagou online. Reembolsos de pagamentos online fazem-se no painel do Stripe.
- Bloquear um período onde já há marcações não as cancela: o painel avisa e é preciso tratar delas à mão.

## Notas
- A base de dados é `DATA_DIR/bookings.db`; faça cópias de segurança.
- Guarda nome, telemóvel e email dos clientes: convém ter uma política de privacidade (RGPD) no site.
