import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken } from "@/lib/meta/encryption";

// ─── Types ───────────────────────────────────────────────────

interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
}

interface MetaLongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface MetaAdAccount {
  id: string; // "act_XXXXXXXXX"
  name: string;
  account_id: string; // numeric id without "act_" prefix
  account_status: number;
  business?: {
    id: string;
    name: string;
  };
}

interface MetaAdAccountsResponse {
  data: MetaAdAccount[];
  paging?: { cursors: { before: string; after: string }; next?: string };
}

interface MetaErrorResponse {
  error: {
    message: string;
    type: string;
    code: number;
    fbtrace_id: string;
  };
}

// ─── Constants ───────────────────────────────────────────────

const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";
const DASHBOARD_PATH = "/dashboard";

// ─── Helpers ─────────────────────────────────────────────────

function env(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function dashboardRedirect(
  request: NextRequest,
  params: Record<string, string>,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = DASHBOARD_PATH;
  url.search = "";
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

// ─── Meta API helpers ────────────────────────────────────────

/**
 * Exchange the short-lived authorization code for a short-lived access token.
 */
async function exchangeCodeForToken(
  code: string,
): Promise<MetaTokenResponse> {
  const url = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", env("META_APP_ID"));
  url.searchParams.set("client_secret", env("META_APP_SECRET"));
  url.searchParams.set("redirect_uri", env("META_REDIRECT_URI"));
  url.searchParams.set("code", code);

  const res = await fetch(url.toString(), { method: "GET" });
  const body = await res.json();

  if (!res.ok || !body.access_token) {
    const error = body as MetaErrorResponse;
    throw new Error(
      `Meta token exchange failed: ${error.error?.message ?? res.statusText}`,
    );
  }

  return body as MetaTokenResponse;
}

/**
 * Exchange a short-lived token for a long-lived token (~60 days).
 */
async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<MetaLongLivedTokenResponse> {
  const url = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", env("META_APP_ID"));
  url.searchParams.set("client_secret", env("META_APP_SECRET"));
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  const res = await fetch(url.toString(), { method: "GET" });
  const body = await res.json();

  if (!res.ok || !body.access_token) {
    const error = body as MetaErrorResponse;
    throw new Error(
      `Meta long-lived token exchange failed: ${error.error?.message ?? res.statusText}`,
    );
  }

  return body as MetaLongLivedTokenResponse;
}

/**
 * Fetch the user's ad accounts from the Marketing API.
 */
async function fetchAdAccounts(
  accessToken: string,
): Promise<MetaAdAccount[]> {
  const url = new URL(`${META_GRAPH_BASE}/me/adaccounts`);
  url.searchParams.set("fields", "id,name,account_id,account_status,business{id,name}");
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("limit", "100");

  const res = await fetch(url.toString(), { method: "GET" });
  const body = await res.json();

  if (!res.ok || !body.data) {
    const error = body as MetaErrorResponse;
    throw new Error(
      `Failed to fetch ad accounts: ${error.error?.message ?? res.statusText}`,
    );
  }

  return (body as MetaAdAccountsResponse).data;
}

// ─── GET /api/meta/callback ─────────────────────────────────
//
// Meta redirects here with ?code=...&state=...
//
// Flow:
//   1. Validate code + state params
//   2. Authenticate user session
//   3. Look up & validate state from DB (CSRF check + expiry)
//   4. Exchange code → short-lived token → long-lived token
//   5. Fetch ad accounts from /me/adaccounts
//   6. Store first ad account + encrypted token
//   7. Delete used state entry
//   8. Redirect to dashboard
// ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── 1. Validate query params ───────────────────────────────
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  // User denied permissions or Meta returned an error
  if (errorParam) {
    const errorDesc =
      searchParams.get("error_description") ?? "Unknown error from Meta";
    console.error("[meta/callback] OAuth denied:", errorParam, errorDesc);
    return dashboardRedirect(request, {
      meta_error: "access_denied",
      message: errorDesc,
    });
  }

  if (!code || !state) {
    return dashboardRedirect(request, {
      meta_error: "invalid_request",
      message: "Missing code or state parameter",
    });
  }

  // ── 2. Authenticate user ──────────────────────────────────
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return dashboardRedirect(request, {
      meta_error: "unauthorized",
      message: "Session expired — please log in and try again",
    });
  }

  // ── 3. Validate state (CSRF + expiry) ─────────────────────
  const { data: oauthState, error: stateError } = await supabase
    .from("meta_oauth_states")
    .select("id, user_id, client_id, expires_at")
    .eq("state", state)
    .eq("user_id", user.id)
    .maybeSingle();

  if (stateError) {
    console.error("[meta/callback] State lookup failed:", stateError.message);
    return dashboardRedirect(request, {
      meta_error: "server_error",
      message: "Failed to validate OAuth state",
    });
  }

  if (!oauthState) {
    return dashboardRedirect(request, {
      meta_error: "invalid_state",
      message: "Invalid or already-used OAuth state",
    });
  }

  // Check expiry
  if (new Date(oauthState.expires_at) < new Date()) {
    // Clean up expired state
    await supabase.from("meta_oauth_states").delete().eq("id", oauthState.id);
    return dashboardRedirect(request, {
      meta_error: "expired_state",
      message: "OAuth session expired — please try connecting again",
    });
  }

  const clientId = oauthState.client_id;

  // ── 4. Exchange code → tokens ─────────────────────────────
  let longLivedToken: MetaLongLivedTokenResponse;

  try {
    // Step A: code → short-lived token
    const shortLived = await exchangeCodeForToken(code);

    // Step B: short-lived → long-lived token (~60 days)
    longLivedToken = await exchangeForLongLivedToken(shortLived.access_token);
  } catch (err) {
    console.error("[meta/callback] Token exchange failed:", err);
    // Clean up state since the flow failed
    await supabase.from("meta_oauth_states").delete().eq("id", oauthState.id);
    return dashboardRedirect(request, {
      meta_error: "token_exchange_failed",
      message: "Failed to obtain access token from Meta",
    });
  }

  // ── 5. Fetch ad accounts ──────────────────────────────────
  let adAccounts: MetaAdAccount[];

  try {
    adAccounts = await fetchAdAccounts(longLivedToken.access_token);
  } catch (err) {
    console.error("[meta/callback] Ad account fetch failed:", err);
    await supabase.from("meta_oauth_states").delete().eq("id", oauthState.id);
    return dashboardRedirect(request, {
      meta_error: "fetch_accounts_failed",
      message: "Connected to Meta but failed to retrieve ad accounts",
    });
  }

  if (adAccounts.length === 0) {
    await supabase.from("meta_oauth_states").delete().eq("id", oauthState.id);
    return dashboardRedirect(request, {
      meta_error: "no_accounts",
      message: "No ad accounts found for this Meta user",
    });
  }

  // Use the first active ad account (account_status 1 = ACTIVE)
  const activeAccount =
    adAccounts.find((a) => a.account_status === 1) ?? adAccounts[0];

  // ── 6. Store ad account + encrypted token ─────────────────
  // Use admin client (service_role) for all DB writes — bypasses RLS
  // and ensures token insert is always allowed.
  const adminClient = createAdminClient();

  const tokenExpiresAt = new Date(
    Date.now() + longLivedToken.expires_in * 1000,
  ).toISOString();

  const encryptedToken = encryptToken(longLivedToken.access_token);

  // Upsert the ad account (handles reconnection after disconnect)
  const { data: adAccountRow, error: upsertError } = await adminClient
    .from("meta_ad_accounts")
    .upsert(
      {
        user_id: user.id,
        client_id: clientId,
        meta_account_id: activeAccount.id,
        meta_account_name: activeAccount.name,
        meta_business_id: activeAccount.business?.id ?? null,
        is_active: true,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id,client_id" },
    )
    .select("id")
    .single();

  if (upsertError || !adAccountRow) {
    console.error(
      "[meta/callback] Ad account upsert failed:",
      upsertError?.message,
      upsertError?.details,
      upsertError?.hint,
    );
    await supabase.from("meta_oauth_states").delete().eq("id", oauthState.id);
    return dashboardRedirect(request, {
      meta_error: "save_failed",
      message: "Failed to save ad account connection",
    });
  }

  // Upsert the token (service_role bypasses RLS)
  const { error: tokenError } = await adminClient.from("meta_tokens").upsert(
    {
      meta_ad_account_id: adAccountRow.id,
      access_token_enc: encryptedToken,
      token_expires_at: tokenExpiresAt,
      scopes: "ads_read,ads_management,business_management",
      last_refreshed_at: new Date().toISOString(),
      refresh_error: null,
    },
    { onConflict: "meta_ad_account_id" },
  );

  if (tokenError) {
    console.error("[meta/callback] Token upsert failed:", {
      message: tokenError.message,
      details: tokenError.details,
      hint: tokenError.hint,
      code: tokenError.code,
      adAccountId: adAccountRow.id,
    });
    await supabase.from("meta_oauth_states").delete().eq("id", oauthState.id);
    return dashboardRedirect(request, {
      meta_error: "save_failed",
      message: "Failed to store access token",
    });
  }

  // ── 7. Delete used state entry ────────────────────────────
  await supabase.from("meta_oauth_states").delete().eq("id", oauthState.id);

  // ── 8. Redirect to dashboard with success ─────────────────
  return dashboardRedirect(request, {
    meta_connected: "true",
    client_id: clientId,
    account_name: activeAccount.name ?? activeAccount.id,
  });
}
