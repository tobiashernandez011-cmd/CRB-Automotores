create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  customer text not null check (char_length(trim(customer)) > 0),
  vehicle text not null default '',
  plate text not null default '',
  year text not null default '',
  phone text not null default '',
  quote_date date not null,
  repair text not null default '',
  replace text not null default '',
  parts numeric(14, 2) not null default 0 check (parts >= 0),
  labor numeric(14, 2) not null default 0 check (labor >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists quotes_created_at_idx
  on public.quotes (created_at desc);

create index if not exists quotes_customer_idx
  on public.quotes (customer);

alter table public.quotes enable row level security;

drop policy if exists "Authenticated staff can view quotes"
  on public.quotes;
create policy "Authenticated staff can view quotes"
  on public.quotes
  for select
  to authenticated
  using (true);

drop policy if exists "Staff can create quotes for themselves"
  on public.quotes;
create policy "Staff can create quotes for themselves"
  on public.quotes
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

grant select, insert on public.quotes to authenticated;
