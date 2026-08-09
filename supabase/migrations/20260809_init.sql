-- Initial schema for Solidus Bingo

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  host_id uuid,
  status text not null default 'waiting',
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete cascade,
  username text not null,
  card jsonb,
  joined_at timestamptz not null default now()
);

create table if not exists public.called_numbers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete cascade,
  number int not null,
  called_at timestamptz not null default now()
);
