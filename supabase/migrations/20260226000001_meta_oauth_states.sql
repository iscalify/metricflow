-- ============================================================
-- OAuth state parameter storage (CSRF protection)
-- Short-lived rows; cleaned up after use or expiry.
-- ============================================================

create table public.meta_oauth_states (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  client_id   text        not null,
  state       text        not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),

  constraint uq_meta_oauth_states_state unique (state)
);

-- Fast lookup by state value during callback
create index idx_meta_oauth_states_state on public.meta_oauth_states(state);

-- Cleanup index for expired rows
create index idx_meta_oauth_states_expires on public.meta_oauth_states(expires_at);

-- RLS: only the owning user can see their own states
alter table public.meta_oauth_states enable row level security;

create policy "Users manage own oauth states"
  on public.meta_oauth_states for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
