import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SyncButton } from "./sync-button";
import { SeedDemoButton } from "./seed-demo-button";
import { MetricCards } from "./metric-cards";
import { CampaignTable } from "./campaign-table";

export default async function AnalyticsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch connected account
  const { data: accounts } = await supabase
    .from("meta_ad_accounts")
    .select("id, meta_account_id, meta_account_name")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1);

  const account = accounts?.[0];

  if (!account) {
    redirect(
      "/dashboard?meta_error=true&message=No+connected+account.+Connect+Meta+Ads+first.",
    );
  }

  // Fetch insights (last 30 days aggregated per campaign)
  const { data: insights } = await supabase
    .from("meta_campaign_insights")
    .select("*")
    .eq("meta_ad_account_id", account.id)
    .order("date_start", { ascending: false });

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
            Campaign performance for{" "}
            <span className="font-medium text-foreground">
              {account.meta_account_name ?? account.meta_account_id}
            </span>
          </p>
        </div>
        <SyncButton />
      </div>

      <Separator />

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-lg font-semibold">No insights data yet</p>
          <p className="mb-6 max-w-md text-sm text-muted-foreground">
            Click &quot;Sync Data&quot; to fetch your campaign performance from
            Meta, or load demo data to preview the dashboard.
          </p>
          <div className="flex items-center gap-4">
            <SyncButton />
            <SeedDemoButton />
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
