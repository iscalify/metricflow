-- ============================================================
-- Shopify Integration Schema
-- Mirrors meta_ad_accounts / meta_tokens pattern
-- Multi-tenant: agency (auth.users) → clients → Shopify stores
-- ============================================================

-- ============================================================
-- 1. shopify_stores
--    One row per connected Shopify store.
-- ============================================================
create table public.shopify_stores (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,

  -- Shopify identifiers
  shop_domain     text not null,                    -- e.g. "my-store.myshopify.com"
  shop_name       text,                             -- Human-readable store name
  shop_id         text,                             -- Shopify numeric shop ID

  -- Client scoping (agency multi-tenancy)
  client_id       text not null,                    -- Agency-defined client identifier

  -- Status
  is_active       boolean not null default true,
  connected_at    timestamptz not null default now(),

  -- Housekeeping
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Each client can connect exactly one Shopify store
  constraint uq_shopify_stores_client unique (user_id, client_id),

  -- Prevent same shop being linked twice under one agency user
  constraint uq_shopify_stores_domain unique (user_id, shop_domain)
);

create index idx_shopify_stores_user_id on public.shopify_stores(user_id);

-- ============================================================
-- 2. shopify_tokens
--    Stores encrypted OAuth access tokens.
--    Shopify offline tokens do NOT expire — they last until
--    the merchant uninstalls the app.
-- ============================================================
create table public.shopify_tokens (
  id                uuid primary key default gen_random_uuid(),
  shopify_store_id  uuid not null references public.shopify_stores(id) on delete cascade,

  -- Encrypted token (AES-256-GCM, same as Meta tokens)
  access_token_enc  text not null,

  -- Scopes granted (comma-separated)
  scopes            text,

  -- Housekeeping
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- One token row per store
  constraint uq_shopify_tokens_store unique (shopify_store_id)
);

-- ============================================================
-- 3. shopify_sync_logs
--    Audit log for every Shopify data sync attempt.
-- ============================================================
create table public.shopify_sync_logs (
  id                uuid primary key default gen_random_uuid(),
  shopify_store_id  uuid not null references public.shopify_stores(id) on delete cascade,

  sync_type         text not null,                  -- e.g. 'orders', 'products', 'customers'
  status            public.sync_status not null default 'pending',
  started_at        timestamptz,
  completed_at      timestamptz,
  records_synced    int not null default 0,

  error_message     text,
  error_code        text,

  sync_date_from    date,
  sync_date_to      date,

  created_at        timestamptz not null default now()
);

create index idx_shopify_sync_logs_store
  on public.shopify_sync_logs(shopify_store_id, created_at desc);

-- ============================================================
-- 4. shopify_oauth_states (CSRF protection)
-- ============================================================
create table public.shopify_oauth_states (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  client_id   text not null,
  shop_domain text not null,
  state       text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),

  constraint uq_shopify_oauth_states_state unique (state)
);

create index idx_shopify_oauth_states_state on public.shopify_oauth_states(state);
create index idx_shopify_oauth_states_expires on public.shopify_oauth_states(expires_at);

-- ============================================================
-- 5. RLS Policies
-- ============================================================

-- shopify_stores
alter table public.shopify_stores enable row level security;

create policy "Agency owner manages own stores"
  on public.shopify_stores for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Service role manages all stores"
  on public.shopify_stores for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- shopify_tokens (service_role only for writes, agency owner can read/delete)
alter table public.shopify_tokens enable row level security;

create policy "Agency owner reads own tokens"
  on public.shopify_tokens for select
  using (
    exists (
      select 1 from public.shopify_stores s
      where s.id = shopify_tokens.shopify_store_id
        and s.user_id = auth.uid()
    )
  );

create policy "Agency owner deletes own tokens"
  on public.shopify_tokens for delete
  using (
    exists (
      select 1 from public.shopify_stores s
      where s.id = shopify_tokens.shopify_store_id
        and s.user_id = auth.uid()
    )
  );

create policy "Service role manages all tokens"
  on public.shopify_tokens for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- shopify_sync_logs
alter table public.shopify_sync_logs enable row level security;

create policy "Agency owner reads own sync logs"
  on public.shopify_sync_logs for select
  using (
    exists (
      select 1 from public.shopify_stores s
      where s.id = shopify_sync_logs.shopify_store_id
        and s.user_id = auth.uid()
    )
  );

create policy "Service role manages all sync logs"
  on public.shopify_sync_logs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- shopify_oauth_states
alter table public.shopify_oauth_states enable row level security;

create policy "Users manage own shopify oauth states"
  on public.shopify_oauth_states for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 6. Triggers
-- ============================================================
create trigger trg_shopify_stores_updated_at
  before update on public.shopify_stores
  for each row execute function public.set_updated_at();

create trigger trg_shopify_tokens_updated_at
  before update on public.shopify_tokens
  for each row execute function public.set_updated_at();
