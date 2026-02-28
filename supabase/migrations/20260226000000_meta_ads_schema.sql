-- ============================================================
-- MetricFlow: Meta Ads Integration Schema
-- Multi-tenant: agency (auth.users) → clients → ad accounts
-- ============================================================

-- Enable pgcrypto for encryption helpers (already enabled on Supabase,
-- but idempotent just in case)
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. meta_ad_accounts
--    One row per client-connected Meta Ad Account.
--    An agency user (auth.users) owns many clients;
--    each client may connect exactly ONE ad account.
-- ============================================================
create table public.meta_ad_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- Meta identifiers
  meta_account_id   text    not null,              -- Meta Ad Account ID (act_XXXXXXXXX)
  meta_account_name text,                          -- Human-readable name from API
  meta_business_id  text,                          -- Optional: parent Business Manager ID

  -- Client scoping (agency multi-tenancy)
  client_id     text    not null,                  -- Agency-defined client identifier

  -- Status
  is_active     boolean not null default true,
  connected_at  timestamptz not null default now(),

  -- Housekeeping
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Each client can connect exactly one ad account
  constraint uq_meta_ad_accounts_client unique (user_id, client_id),

  -- Prevent the same Meta account being linked twice under one agency user
  constraint uq_meta_ad_accounts_meta   unique (user_id, meta_account_id)
);

-- Fast lookups by owning user
create index idx_meta_ad_accounts_user_id on public.meta_ad_accounts(user_id);

-- ============================================================
-- 2. meta_tokens
--    Stores encrypted OAuth tokens.
--    One token row per ad-account connection. Decryption happens
--    exclusively on the server via pgp_sym_decrypt or app-layer AES.
-- ============================================================
create table public.meta_tokens (
  id                 uuid primary key default gen_random_uuid(),
  meta_ad_account_id uuid not null references public.meta_ad_accounts(id) on delete cascade,

  -- Encrypted token blobs (encrypt at app layer before INSERT)
  access_token_enc   text    not null,             -- AES-256-GCM encrypted access token
  -- Meta long-lived tokens last ~60 days; store exact expiry
  token_expires_at   timestamptz not null,

  -- Scopes granted (comma-separated or JSON array)
  scopes             text,

  -- Refresh metadata
  last_refreshed_at  timestamptz,
  refresh_error      text,                         -- Last refresh error message, if any

  -- Housekeeping
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- One token row per ad-account
  constraint uq_meta_tokens_account unique (meta_ad_account_id)
);

-- Quick expiry-check queries for background refresh jobs
create index idx_meta_tokens_expires_at on public.meta_tokens(token_expires_at);

-- ============================================================
-- 3. meta_sync_logs
--    Append-only audit log for every background sync attempt.
--    Used for debugging, retry logic, and user-facing status.
-- ============================================================
create type public.sync_status as enum ('pending', 'running', 'success', 'failed');

create table public.meta_sync_logs (
  id                 uuid primary key default gen_random_uuid(),
  meta_ad_account_id uuid not null references public.meta_ad_accounts(id) on delete cascade,

  -- Sync details
  sync_type          text        not null,           -- e.g. 'campaigns', 'adsets', 'ads', 'insights'
  status             public.sync_status not null default 'pending',
  started_at         timestamptz,
  completed_at       timestamptz,
  records_synced     int         not null default 0,

  -- Error capture
  error_message      text,
  error_code         text,                           -- Meta API error code if applicable

  -- Date range that was synced (for insights)
  sync_date_from     date,
  sync_date_to       date,

  -- Housekeeping
  created_at         timestamptz not null default now()
);

-- Recent syncs per account (dashboard & polling)
create index idx_meta_sync_logs_account   on public.meta_sync_logs(meta_ad_account_id, created_at desc);
-- Find stale/failed syncs for retry workers
create index idx_meta_sync_logs_status    on public.meta_sync_logs(status) where status in ('pending', 'running', 'failed');

-- ============================================================
-- Row Level Security
-- Only the owning user can read/write their own data.
-- ============================================================
alter table public.meta_ad_accounts enable row level security;
alter table public.meta_tokens       enable row level security;
alter table public.meta_sync_logs    enable row level security;

-- meta_ad_accounts
create policy "Users manage own ad accounts"
  on public.meta_ad_accounts for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- meta_tokens (join through meta_ad_accounts to verify ownership)
create policy "Users manage own tokens"
  on public.meta_tokens for all
  using (
    exists (
      select 1 from public.meta_ad_accounts a
      where a.id = meta_ad_account_id
        and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.meta_ad_accounts a
      where a.id = meta_ad_account_id
        and a.user_id = auth.uid()
    )
  );

-- meta_sync_logs (read-only for the owning user; writes come from service_role)
create policy "Users read own sync logs"
  on public.meta_sync_logs for select
  using (
    exists (
      select 1 from public.meta_ad_accounts a
      where a.id = meta_ad_account_id
        and a.user_id = auth.uid()
    )
  );

-- Allow service_role (background workers) full access (bypasses RLS by default,
-- but explicit policy keeps things documented)
create policy "Service role manages sync logs"
  on public.meta_sync_logs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ============================================================
-- updated_at trigger (reusable)
-- ============================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_meta_ad_accounts_updated_at
  before update on public.meta_ad_accounts
  for each row execute function public.set_updated_at();

create trigger trg_meta_tokens_updated_at
  before update on public.meta_tokens
  for each row execute function public.set_updated_at();
