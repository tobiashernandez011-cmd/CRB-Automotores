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
  created_at timestamptz not null default now(),
  customer_email text not null default '',
  pdf_path text
);

alter table public.quotes
  add column if not exists customer_email text not null default '',
  add column if not exists pdf_path text;

create index if not exists quotes_quote_date_idx
  on public.quotes (quote_date desc, created_at desc);

create index if not exists quotes_customer_idx
  on public.quotes (customer);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quotes_customer_length_check'
      and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_customer_length_check
      check (char_length(trim(customer)) between 1 and 200) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'quotes_fields_length_check'
      and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_fields_length_check
      check (
        char_length(vehicle) <= 120
        and char_length(plate) <= 20
        and char_length(year) <= 10
        and char_length(phone) <= 32
        and char_length(customer_email) <= 254
        and (customer_email = '' or customer_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
        and char_length(repair) <= 10000
        and char_length(replace) <= 10000
      ) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'quotes_pdf_path_check'
      and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_pdf_path_check
      check (
        pdf_path is null
        or pdf_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
      ) not valid;
  end if;
end
$$;

alter table public.quotes enable row level security;

create table if not exists public.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.staff_members enable row level security;
revoke all on public.staff_members from anon, authenticated, public;

create or replace function public.is_authorized_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_members
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_authorized_staff() from anon, public;
grant execute on function public.is_authorized_staff() to authenticated;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'quotes'
  loop
    execute format('drop policy %I on public.quotes', existing_policy.policyname);
  end loop;
end
$$;

create policy "All staff can view quotes"
  on public.quotes
  for select
  to authenticated
  using ((select public.is_authorized_staff()));

create policy "Staff can create their own quotes"
  on public.quotes
  for insert
  to authenticated
  with check (
    (select public.is_authorized_staff())
    and created_by = (select auth.uid())
  );

create policy "Authorized staff can update quotes"
  on public.quotes
  for update
  to authenticated
  using ((select public.is_authorized_staff()))
  with check ((select public.is_authorized_staff()));

revoke all on public.quotes from anon, public;
revoke update on public.quotes from authenticated;
grant select, insert on public.quotes to authenticated;
grant update (
  customer,
  vehicle,
  plate,
  year,
  phone,
  quote_date,
  repair,
  replace,
  parts,
  labor,
  customer_email,
  pdf_path
) on public.quotes to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quote-pdfs', 'quote-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf'];

drop policy if exists "Authenticated users can read quote PDFs" on storage.objects;
drop policy if exists "Authenticated users can upload quote PDFs" on storage.objects;
drop policy if exists "Uploaders can delete their quote PDFs" on storage.objects;
drop policy if exists "Authorized staff can delete quote PDFs" on storage.objects;

create policy "Authenticated users can read quote PDFs"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'quote-pdfs'
    and (select public.is_authorized_staff())
  );

create policy "Authenticated users can upload quote PDFs"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'quote-pdfs'
    and (select public.is_authorized_staff())
    and owner_id = (select auth.uid())
  );

create policy "Authorized staff can delete quote PDFs"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'quote-pdfs'
    and (select public.is_authorized_staff())
  );

create policy "Authorized staff can delete quotes"
  on public.quotes
  for delete
  to authenticated
  using ((select public.is_authorized_staff()));

grant delete on public.quotes to authenticated;
