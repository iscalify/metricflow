import { decryptToken } from "@/lib/meta/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

// ─── Types ───────────────────────────────────────────────────

export interface MetaCampaignInsight {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  date_stop: string;
  impressions: string;
  clicks: string;
  spend: string;
  reach: string;
  ctr: string;
  cpc: string;
  cpm: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
  objective: string;
}

interface MetaInsightsResponse {
  data: MetaCampaignInsight[];
  paging?: { cursors: { before: string; after: string }; next?: string };
}

interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  objective: string;
}

interface MetaCampaignsResponse {
  data: MetaCampaign[];
  paging?: { next?: string };
}

// ─── Constants ───────────────────────────────────────────────

const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";

const INSIGHTS_FIELDS = [
  "campaign_id",
  "campaign_name",
  "impressions",
  "clicks",
  "spend",
  "reach",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "action_values",
  "objective",
].join(",");

// ─── Helpers ─────────────────────────────────────────────────

function extractConversions(actions?: { action_type: string; value: string }[]): number {
  if (!actions) return 0;
  const purchase = actions.find(
    (a) =>
      a.action_type === "purchase" ||
      a.action_type === "offsite_conversion.fb_pixel_purchase",
  );
  if (purchase) return parseInt(purchase.value, 10);

  // Fallback: total conversions
  const total = actions.find((a) => a.action_type === "omni_purchase");
  return total ? parseInt(total.value, 10) : 0;
}

function extractConversionValue(
  actionValues?: { action_type: string; value: string }[],
): number {
  if (!actionValues) return 0;
  const purchase = actionValues.find(
    (a) =>
      a.action_type === "purchase" ||
      a.action_type === "offsite_conversion.fb_pixel_purchase",
  );
  if (purchase) return parseFloat(purchase.value);

  const total = actionValues.find((a) => a.action_type === "omni_purchase");
  return total ? parseFloat(total.value) : 0;
}

// ─── Fetch insights from Meta API ────────────────────────────

/**
 * Fetch campaign-level insights from the Meta Marketing API.
 * Returns raw insight rows for the given date range.
 */
export async function fetchCampaignInsights(
  accessToken: string,
  adAccountId: string,
  dateFrom: string, // YYYY-MM-DD
  dateTo: string,
): Promise<MetaCampaignInsight[]> {
  const allInsights: MetaCampaignInsight[] = [];
  let url: string | null =
    `${META_GRAPH_BASE}/${adAccountId}/insights?` +
    new URLSearchParams({
      fields: INSIGHTS_FIELDS,
      level: "campaign",
      time_range: JSON.stringify({
        since: dateFrom,
        until: dateTo,
      }),
      time_increment: "1", // daily breakdown
      limit: "100",
      access_token: accessToken,
    }).toString();

  while (url) {
    const res = await fetch(url);
    const body = await res.json();

    if (!res.ok || body.error) {
      throw new Error(
        `Meta Insights API error: ${body.error?.message ?? res.statusText}`,
      );
    }

    const data = body as MetaInsightsResponse;
    allInsights.push(...data.data);

    url = data.paging?.next ?? null;
  }

  return allInsights;
}

// ─── Sync insights to DB ─────────────────────────────────────

/**
 * Fetches insights from Meta and upserts them into the campaign_insights table.
 * Uses the admin client (service_role) for DB writes.
 */
export async function syncInsightsForAccount(
  metaAdAccountDbId: string, // our DB uuid
  metaAccountId: string, // act_XXXXXXXXX
  encryptedToken: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ synced: number; error?: string }> {
  const accessToken = decryptToken(encryptedToken);
  const adminClient = createAdminClient();

  let insights: MetaCampaignInsight[];
  try {
    insights = await fetchCampaignInsights(
      accessToken,
      metaAccountId,
      dateFrom,
      dateTo,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Log to sync_logs
    await adminClient.from("meta_sync_logs").insert({
      meta_ad_account_id: metaAdAccountDbId,
      sync_type: "insights",
      status: "failed",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error_message: message,
      sync_date_from: dateFrom,
      sync_date_to: dateTo,
    });
    return { synced: 0, error: message };
  }

  if (insights.length === 0) {
    return { synced: 0 };
  }

  // Transform and upsert
  const rows = insights.map((i) => {
    const conversions = extractConversions(i.actions);
    const conversionValue = extractConversionValue(i.action_values);
    const spend = parseFloat(i.spend);

    return {
      meta_ad_account_id: metaAdAccountDbId,
      campaign_id: i.campaign_id,
      campaign_name: i.campaign_name,
      date_start: i.date_start,
      date_stop: i.date_stop,
      impressions: parseInt(i.impressions, 10),
      clicks: parseInt(i.clicks, 10),
      spend,
      reach: parseInt(i.reach, 10),
      ctr: parseFloat(i.ctr),
      cpc: parseFloat(i.cpc || "0"),
      cpm: parseFloat(i.cpm || "0"),
      conversions,
      conversion_value: conversionValue,
      cost_per_conversion:
        conversions > 0 ? Math.round((spend / conversions) * 10000) / 10000 : 0,
      campaign_status: null as string | null, // filled below if available
      objective: i.objective,
    };
  });

  const { error: upsertError } = await adminClient
    .from("meta_campaign_insights")
    .upsert(rows, {
      onConflict: "meta_ad_account_id,campaign_id,date_start",
    });

  if (upsertError) {
    await adminClient.from("meta_sync_logs").insert({
      meta_ad_account_id: metaAdAccountDbId,
      sync_type: "insights",
      status: "failed",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error_message: upsertError.message,
      sync_date_from: dateFrom,
      sync_date_to: dateTo,
    });
    return { synced: 0, error: upsertError.message };
  }

  // Log success
  await adminClient.from("meta_sync_logs").insert({
    meta_ad_account_id: metaAdAccountDbId,
    sync_type: "insights",
    status: "success",
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    records_synced: rows.length,
    sync_date_from: dateFrom,
    sync_date_to: dateTo,
  });

  return { synced: rows.length };
}
