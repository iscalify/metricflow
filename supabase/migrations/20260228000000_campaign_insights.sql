-- ============================================================
-- Meta Campaign Insights — cached ad performance data
-- Stores daily aggregated metrics fetched from Meta Marketing API
-- ============================================================

create table public.meta_campaign_insights (
  id                 uuid primary key default gen_random_uuid(),
  meta_ad_account_id uuid not null references public.meta_ad_accounts(id) on delete cascade,

  -- Campaign identifiers
  campaign_id        text not null,
  campaign_name      text,

  -- Date of the insight (one row per campaign per day)
  date_start         date not null,
  date_stop          date not null,

  -- Core metrics
  impressions        bigint  not null default 0,
  clicks             bigint  not null default 0,
  spend              numeric(12,2) not null default 0,
  reach              bigint  not null default 0,

  -- Calculated metrics (stored for fast reads)
  ctr                numeric(8,4) default 0,        -- click-through rate %
  cpc                numeric(10,4) default 0,        -- cost per click
  cpm                numeric(10,4) default 0,        -- cost per 1000 impressions

  -- Conversion metrics (may be null if not available)
  conversions        bigint  default 0,
  conversion_value   numeric(12,2) default 0,        -- purchase/revenue value
  cost_per_conversion numeric(10,4) default 0,

  -- Campaign status
  campaign_status    text,                            -- ACTIVE, PAUSED, etc.
  objective          text,                            -- CONVERSIONS, TRAFFIC, etc.

  -- Housekeeping
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- One row per account + campaign + day
  constraint uq_campaign_insights_day unique (meta_ad_account_id, campaign_id, date_start)
);

-- Dashboard queries: recent insights per account
create index idx_campaign_insights_account_date
  on public.meta_campaign_insights(meta_ad_account_id, date_start desc);

-- Filter by campaign
create index idx_campaign_insights_campaign
  on public.meta_campaign_insights(campaign_id, date_start desc);

-- RLS
alter table public.meta_campaign_insights enable row level security;

-- Agency owner reads own insights
create policy "Agency reads own insights"
  on public.meta_campaign_insights for select
  using (
    exists (
      select 1 from public.meta_ad_accounts a
      where a.id = meta_campaign_insights.meta_ad_account_id
        and a.user_id = auth.uid()
    )
  );

-- Client viewer reads granted insights
create policy "Client viewer reads insights"
  on public.meta_campaign_insights for select
  using (
    exists (
      select 1 from public.meta_ad_accounts a
      join public.client_viewers cv
        on cv.agency_id = a.user_id and cv.client_id = a.client_id
      where a.id = meta_campaign_insights.meta_ad_account_id
        and cv.viewer_id = auth.uid()
    )
  );

-- Service role: full write access (sync workers)
create policy "Service role manages insights"
  on public.meta_campaign_insights for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- updated_at trigger
create trigger trg_campaign_insights_updated_at
  before update on public.meta_campaign_insights
  for each row execute function public.set_updated_at();
