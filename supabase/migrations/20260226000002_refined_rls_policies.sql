-- ============================================================
-- Refined RLS policies for meta_ad_accounts & meta_tokens
--
-- Roles:
--   agency user  → full CRUD on their own clients' data
--   client viewer → read-only on accounts they've been granted access to
--   service_role  → full access (bypasses RLS, but explicit for docs)
--   anon / public → zero access
--
-- Principle: least privilege, no cross-agency data access.
-- ============================================================

-- ┌──────────────────────────────────────────────────────────┐
-- │  Client viewers table                                    │
-- │  Maps a viewer (auth.users) to a specific client under   │
-- │  a specific agency. Grants read-only ad account access.  │
-- └──────────────────────────────────────────────────────────┘

create table if not exists public.client_viewers (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references auth.users(id) on delete cascade,  -- the agency owner
  viewer_id  uuid not null references auth.users(id) on delete cascade,  -- the client viewer
  client_id  text not null,                                               -- agency-scoped client

  created_at timestamptz not null default now(),

  constraint uq_client_viewers unique (agency_id, viewer_id, client_id)
);

create index idx_client_viewers_viewer on public.client_viewers(viewer_id);

alter table public.client_viewers enable row level security;

-- Agency owners manage their own viewer grants
create policy "Agency manages own viewers"
  on public.client_viewers for all
  using  (auth.uid() = agency_id)
  with check (auth.uid() = agency_id);

-- Viewers can see their own grants (needed for UI)
create policy "Viewers read own grants"
  on public.client_viewers for select
  using (auth.uid() = viewer_id);


-- ┌──────────────────────────────────────────────────────────┐
-- │  Drop old broad policies                                 │
-- └──────────────────────────────────────────────────────────┘

drop policy if exists "Users manage own ad accounts" on public.meta_ad_accounts;
drop policy if exists "Users manage own tokens"      on public.meta_tokens;


-- ┌──────────────────────────────────────────────────────────┐
-- │  meta_ad_accounts — granular policies                    │
-- └──────────────────────────────────────────────────────────┘

-- Agency owner: full SELECT
create policy "Agency reads own ad accounts"
  on public.meta_ad_accounts for select
  using (auth.uid() = user_id);

-- Agency owner: INSERT (connect new clients)
create policy "Agency inserts own ad accounts"
  on public.meta_ad_accounts for insert
  with check (auth.uid() = user_id);

-- Agency owner: UPDATE (toggle is_active, rename, etc.)
create policy "Agency updates own ad accounts"
  on public.meta_ad_accounts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Agency owner: DELETE (disconnect)
create policy "Agency deletes own ad accounts"
  on public.meta_ad_accounts for delete
  using (auth.uid() = user_id);

-- Client viewer: read-only via client_viewers grant
create policy "Client viewer reads granted ad accounts"
  on public.meta_ad_accounts for select
  using (
    exists (
      select 1 from public.client_viewers cv
      where cv.viewer_id = auth.uid()
        and cv.agency_id = meta_ad_accounts.user_id
        and cv.client_id = meta_ad_accounts.client_id
    )
  );


-- ┌──────────────────────────────────────────────────────────┐
-- │  meta_tokens — granular policies                         │
-- │                                                          │
-- │  Tokens are sensitive. Only:                             │
-- │    • service_role can INSERT/UPDATE (server-side only)   │
-- │    • agency owner can SELECT (to check status/expiry)    │
-- │    • agency owner can DELETE (revoke on disconnect)      │
-- │    • client viewers get NO access to tokens              │
-- └──────────────────────────────────────────────────────────┘

-- Agency owner: read-only (check expiry, connection status)
create policy "Agency reads own tokens"
  on public.meta_tokens for select
  using (
    exists (
      select 1 from public.meta_ad_accounts a
      where a.id = meta_tokens.meta_ad_account_id
        and a.user_id = auth.uid()
    )
  );

-- Agency owner: delete (revoke token on disconnect flow)
create policy "Agency deletes own tokens"
  on public.meta_tokens for delete
  using (
    exists (
      select 1 from public.meta_ad_accounts a
      where a.id = meta_tokens.meta_ad_account_id
        and a.user_id = auth.uid()
    )
  );

-- Service role: insert + update tokens (OAuth callback & background refresh)
-- NOTE: service_role bypasses RLS by default in Supabase. These policies are
-- explicit documentation and a safety net if RLS bypass is ever disabled.
create policy "Service role inserts tokens"
  on public.meta_tokens for insert
  with check (auth.role() = 'service_role');

create policy "Service role updates tokens"
  on public.meta_tokens for update
  using  (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- No SELECT/INSERT/UPDATE/DELETE policy for client viewers on meta_tokens.
-- Viewers have ZERO access to token data.
