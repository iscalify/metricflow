import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SyncButton } from "./sync-button";
import { SeedDemoButton } from "./seed-demo-button";
import { MetricCards } from "./metric-cards";
import { CampaignTable } from "./campaign-table";

interface InsightRow {
  campaign_id: string;
  campaign_name: string | null;
  objective: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  conversions: number;
  conversion_value: number;
  date_start: string;
}

export default async function AnalyticsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch connected Meta account (may not exist)
  const { data: metaAccounts } = await supabase
    .from("meta_ad_accounts")
    .select("id, meta_account_id, meta_account_name")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1);

  const metaAccount = metaAccounts?.[0] ?? null;

  // Fetch connected Shopify store (may not exist)
  const { data: shopifyStores } = await supabase
    .from("shopify_stores")
    .select("id, shop_domain, shop_name")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1);

  const shopifyStore = shopifyStores?.[0] ?? null;

  // If nothing is connected, show a helpful message instead of redirecting
  if (!metaAccount && !shopifyStore) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
          <p className="text-muted-foreground">
            Connect a platform to start viewing analytics
          </p>
        </div>
        <Separator />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-lg font-semibold">No platforms connected</p>
          <p className="mb-6 max-w-md text-sm text-muted-foreground">
            Go to the Dashboard and connect your Meta Ad Account or Shopify store
            to start tracking performance analytics.
          </p>
          <a href="/dashboard">
            <button className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Go to Dashboard
            </button>
          </a>
        </div>
      </div>
    );
  }

  // Build a label for what's connected
  const connectedPlatforms: string[] = [];
  if (metaAccount) connectedPlatforms.push(metaAccount.meta_account_name ?? metaAccount.meta_account_id);
  if (shopifyStore) connectedPlatforms.push(shopifyStore.shop_name ?? shopifyStore.shop_domain);

  // Fetch Meta insights if account exists
  let insights: InsightRow[] = [];
  if (metaAccount) {
    const { data } = await supabase
      .from("meta_campaign_insights")
      .select("*")
      .eq("meta_ad_account_id", metaAccount.id)
      .order("date_start", { ascending: false });
    insights = (data ?? []) as InsightRow[];
  }

  // Aggregate totals across all campaigns / days
  const totals = (insights ?? []).reduce(
    (acc, row) => {
      acc.impressions += Number(row.impressions);
      acc.clicks += Number(row.clicks);
      acc.spend += Number(row.spend);
      acc.reach += Number(row.reach);
      acc.conversions += Number(row.conversions);
      acc.conversionValue += Number(row.conversion_value);
      return acc;
    },
    {
      impressions: 0,
      clicks: 0,
      spend: 0,
      reach: 0,
      conversions: 0,
      conversionValue: 0,
    },
  );

  const ctr =
    totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  const roas = totals.spend > 0 ? totals.conversionValue / totals.spend : 0;

  // Aggregate by campaign (summing all days)
  const campaignMap = new Map<
    string,
    {
      campaign_id: string;
      campaign_name: string;
      objective: string | null;
      impressions: number;
      clicks: number;
      spend: number;
      reach: number;
      ctr: number;
      cpc: number;
      conversions: number;
      conversionValue: number;
      costPerConversion: number;
      days: number;
    }
  >();

  for (const row of insights ?? []) {
    const existing = campaignMap.get(row.campaign_id);
    if (existing) {
      existing.impressions += Number(row.impressions);
      existing.clicks += Number(row.clicks);
      existing.spend += Number(row.spend);
      existing.reach += Number(row.reach);
      existing.conversions += Number(row.conversions);
      existing.conversionValue += Number(row.conversion_value);
      existing.days += 1;
    } else {
      campaignMap.set(row.campaign_id, {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name ?? "Unnamed",
        objective: row.objective,
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        spend: Number(row.spend),
        reach: Number(row.reach),
        ctr: 0,
        cpc: 0,
        conversions: Number(row.conversions),
        conversionValue: Number(row.conversion_value),
        costPerConversion: 0,
        days: 1,
      });
    }
  }

  // Calculate derived metrics per campaign
  const campaigns = Array.from(campaignMap.values()).map((c) => ({
    ...c,
    ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
    cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
    costPerConversion: c.conversions > 0 ? c.spend / c.conversions : 0,
  }));

  // Sort by spend descending
  campaigns.sort((a, b) => b.spend - a.spend);

  const hasData = (insights ?? []).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
          <p className="text-muted-foreground">
            Performance data for{" "}
            <span className="font-medium text-foreground">
              {connectedPlatforms.join(" & ")}
            </span>
          </p>
        </div>
        {metaAccount && <SyncButton />}
      </div>

      <Separator />

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-lg font-semibold">No insights data yet</p>
          <p className="mb-6 max-w-md text-sm text-muted-foreground">
            {metaAccount
              ? 'Click "Sync Data" to fetch your campaign performance from Meta, or load demo data to preview the dashboard.'
              : "Connect a Meta Ad Account from the Dashboard to sync campaign insights, or load demo data to preview."}
          </p>
          <div className="flex items-center gap-4">
            {metaAccount && <SyncButton />}
            {metaAccount && <SeedDemoButton />}
            {!metaAccount && (
              <a href="/dashboard">
                <button className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                  Go to Dashboard
                </button>
              </a>
            )}
          </div>
        </div>
      ) : (
        <>
          <MetricCards
            impressions={totals.impressions}
            clicks={totals.clicks}
            spend={totals.spend}
            reach={totals.reach}
            ctr={ctr}
            cpc={cpc}
            conversions={totals.conversions}
            conversionValue={totals.conversionValue}
            roas={roas}
          />

          <div>
            <h3 className="mb-4 text-lg font-semibold">Campaign Breakdown</h3>
            <CampaignTable campaigns={campaigns} />
          </div>
        </>
      )}
    </div>
  );
}
