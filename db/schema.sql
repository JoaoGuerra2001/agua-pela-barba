-- Esquema da base de dados (Postgres / Supabase). Idempotente: o servidor corre-o ao arrancar.
create table if not exists public.bookings (
  id text primary key,
  token text not null,
  day text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  "time" text not null check ("time" ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  minutes integer not null check (minutes > 0),
  service_id text not null,
  service_name text not null,
  price_cents integer not null check (price_cents >= 0),
  name text not null,
  phone text not null,
  email text not null default '',
  pay_mode text not null check (pay_mode in ('now','later')),
  status text not null check (status in ('confirmada','paga','a_aguardar_pagamento','cancelada','concluida','faltou')),
  stripe_session text,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists idx_bookings_day on public.bookings(day);
create index if not exists idx_bookings_stripe on public.bookings(stripe_session) where stripe_session is not null;

create table if not exists public.blocks (
  id text primary key,
  day text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  from_time text,
  to_time text,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_blocks_day on public.blocks(day);

-- Dados pessoais: só o servidor acede. RLS ativo e sem políticas = chave pública (anon) não vê nada.
alter table public.bookings enable row level security;
alter table public.blocks enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.bookings, public.blocks from anon, authenticated;
  end if;
end $$;
