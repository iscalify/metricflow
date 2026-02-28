import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/meta/encryption";

/**
 * GET /api/meta/debug
 *
 * Diagnostics: checks what the Meta API actually returns for the ad account.
 * Shows campaigns list + raw insights response (no DB writes).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();

  // Get account + token
  const { data: accounts } = await adminClient
    .from("meta_ad_accounts")
    .select(
      `id, meta_account_id, meta_account_name,
       meta_tokens ( access_token_enc, token_expires_at )`,
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1);

  const account = accounts?.[0];
  if (!account) {
    return NextResponse.json({ error: "No connected account" }, { status: 404 });
  }

  const token = Array.isArray(account.meta_tokens)
    ? account.meta_tokens[0]
    : account.meta_tokens;

  if (!token?.access_token_enc) {
    return NextResponse.json({ error: "No token found" }, { status: 404 });
  }

  const accessToken = decryptToken(token.access_token_enc);
  const adAccountId = account.meta_account_id;

  // 1) List campaigns
  const campaignsUrl = `https://graph.facebook.com/v21.0/${adAccountId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget&access_token=${accessToken}`;
  const campaignsRes = await fetch(campaignsUrl);
  const campaignsBody = await campaignsRes.json();

  // 2) Get raw insights (last 30 days)
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const insightsUrl =
    `https://graph.facebook.com/v21.0/${adAccountId}/insights?` +
    new URLSearchParams({
      fields:
        "campaign_id,campaign_name,impressions,clicks,spend,reach,ctr,cpc,cpm,actions,action_values,objective",
      level: "campaign",
      time_range: JSON.stringify({
        since: thirtyDaysAgo.toISOString().split("T")[0],
        until: now.toISOString().split("T")[0],
      }),
      time_increment: "1",
      limit: "10",
      access_token: accessToken,
    }).toString();

  const insightsRes = await fetch(insightsUrl);
  const insightsBody = await insightsRes.json();

  // 3) Check sync logs
  const { data: syncLogs } = await adminClient
    .from("meta_sync_logs")
    .select("*")
    .eq("meta_ad_account_id", account.id)
    .order("created_at", { ascending: false })
    .limit(5);

  return NextResponse.json({
    account: {
      db_id: account.id,
      meta_account_id: adAccountId,
      name: account.meta_account_name,
      token_expires: token.token_expires_at,
    },
    campaigns: campaignsBody,
    insights: insightsBody,
    recent_sync_logs: syncLogs,
  });
}
