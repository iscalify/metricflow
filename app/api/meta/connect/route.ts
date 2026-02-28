import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

// ─── Constants ───────────────────────────────────────────────
const META_OAUTH_BASE = "https://www.facebook.com/v21.0/dialog/oauth";

const REQUIRED_SCOPES = [
  "ads_read",
  "ads_management",
  "business_management",
] as const;

/** State token lives for 10 minutes — more than enough to complete the flow */
const STATE_TTL_MS = 10 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────

function env(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

// ─── GET /api/meta/connect ───────────────────────────────────
//
// Query params:
//   client_id  — the agency-scoped client to connect
//
// Flow:
//   1. Validate session
//   2. Validate the user owns this client_id (or it's a new client)
//   3. Generate cryptographic state, persist to DB
//   4. Redirect to Meta OAuth dialog
// ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── 1. Read & validate query params ────────────────────────
  const { searchParams } = request.nextUrl;
  const clientId = searchParams.get("client_id");

  if (!clientId || clientId.trim().length === 0) {
    return jsonError("Missing required query parameter: client_id", 400);
  }

  // ── 2. Authenticate ────────────────────────────────────────
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonError("Unauthorized — valid session required", 401);
  }

  // ── 3. Multi-tenant validation ─────────────────────────────
  //
  //  Check if this client already has a connected Meta account.
  //  If a row exists with `is_active = true`, the client is already
  //  connected — prevent duplicate OAuth flows.
  //
  //  If no row exists the client is either new or not yet connected,
  //  which is fine — the callback will create the row.

  const { data: existingAccount, error: lookupError } = await supabase
    .from("meta_ad_accounts")
    .select("id, is_active")
    .eq("user_id", user.id)
    .eq("client_id", clientId.trim())
    .maybeSingle();

  if (lookupError) {
    console.error("[meta/connect] Client lookup failed:", lookupError.message);
    return jsonError("Failed to validate client ownership", 500);
  }

  if (existingAccount?.is_active) {
    return jsonError(
      "This client already has an active Meta Ad Account connection. Disconnect first before reconnecting.",
      409,
    );
  }

  // ── 4. Generate & persist CSRF state ───────────────────────
  const state = randomBytes(32).toString("hex"); // 64-char hex string
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

  const { error: stateError } = await supabase
    .from("meta_oauth_states")
    .insert({
      user_id: user.id,
      client_id: clientId.trim(),
      state,
      expires_at: expiresAt,
    });

  if (stateError) {
    console.error("[meta/connect] State insert failed:", stateError.message);
    return jsonError("Failed to initiate OAuth flow", 500);
  }

  // ── 5. Build Meta OAuth URL & redirect ─────────────────────
  const metaAppId = env("META_APP_ID");
  const redirectUri = env("META_REDIRECT_URI");

  const oauthUrl = new URL(META_OAUTH_BASE);
  oauthUrl.searchParams.set("client_id", metaAppId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("state", state);
  oauthUrl.searchParams.set("scope", REQUIRED_SCOPES.join(","));
  oauthUrl.searchParams.set("response_type", "code");

  return NextResponse.redirect(oauthUrl.toString());
}
