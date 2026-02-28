import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncInsightsForAccount } from "@/lib/meta/insights";

/**
 * POST /api/meta/sync
 *
 * Triggers an insights sync for the authenticated user's connected Meta ad accounts.
 * Fetches last 30 days of campaign data by default.
 *
 * Optional body:
 *   { date_from?: "YYYY-MM-DD", date_to?: "YYYY-MM-DD" }
 */
export async function POST(request: Request) {
  // ── Authenticate ──────────────────────────────────────────
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse optional date range ─────────────────────────────
  const body = await request.json().catch(() => ({}));

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dateFrom =
    body.date_from ?? thirtyDaysAgo.toISOString().split("T")[0];
  const dateTo = body.date_to ?? now.toISOString().split("T")[0];

  // ── Fetch user's connected ad accounts with tokens ────────
  const adminClient = createAdminClient();

  const { data: accounts, error: accountsError } = await adminClient
    .from("meta_ad_accounts")
    .select(
      `
      id,
      meta_account_id,
      meta_account_name,
      meta_tokens (
        access_token_enc,
        token_expires_at
      )
    `,
    )
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (accountsError) {
    console.error("[meta/sync] Failed to fetch accounts:", accountsError.message);
    return NextResponse.json(
      { error: "Failed to fetch connected accounts" },
      { status: 500 },
    );
  }

  if (!accounts || accounts.length === 0) {
    return NextResponse.json(
      { error: "No connected Meta ad accounts found" },
      { status: 404 },
    );
  }

  // ── Sync each account ─────────────────────────────────────
  const results = [];

  for (const account of accounts) {
    const token = Array.isArray(account.meta_tokens)
      ? account.meta_tokens[0]
      : account.meta_tokens;

    if (!token?.access_token_enc) {
      results.push({
        account: account.meta_account_name ?? account.meta_account_id,
        error: "No token found",
        synced: 0,
      });
      continue;
    }

    // Check token expiry
    if (new Date(token.token_expires_at) < new Date()) {
      results.push({
        account: account.meta_account_name ?? account.meta_account_id,
        error: "Token expired — please reconnect",
        synced: 0,
      });
      continue;
    }

    const result = await syncInsightsForAccount(
      account.id,
      account.meta_account_id,
      token.access_token_enc,
      dateFrom,
      dateTo,
    );

    results.push({
      account: account.meta_account_name ?? account.meta_account_id,
      synced: result.synced,
      error: result.error ?? null,
    });
  }

  return NextResponse.json({
    success: true,
    date_from: dateFrom,
    date_to: dateTo,
    results,
  });
}
