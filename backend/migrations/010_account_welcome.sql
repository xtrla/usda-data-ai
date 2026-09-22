-- A durable claim prevents repeated webhooks from sending duplicate welcomes.
create table if not exists public.account_welcome_deliveries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'sending' check (status in ('sending','accepted','uncertain')),
  provider_id text,
  created_at timestamptz not null default now()
);
alter table public.account_welcome_deliveries enable row level security;
revoke all on public.account_welcome_deliveries from anon, authenticated;
grant all on public.account_welcome_deliveries to service_role;
create or replace function public.claim_account_welcome(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.account_welcome_deliveries(user_id) values(p_user_id)
  on conflict(user_id) do nothing;
  return found;
end;
$$;
revoke all on function public.claim_account_welcome(uuid) from public, anon, authenticated;
grant execute on function public.claim_account_welcome(uuid) to service_role;
