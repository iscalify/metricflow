import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHmac } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

// ─── Constants ───────────────────────────────────────────────

const REQUIRED_SCOPES = [
  "read_orders",
  "read_products",
  "read_customers",
  "read_analytics",
] as const;

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Helpers ─────────────────────────────────────────────────

function env(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Validate that the shop domain is a legitimate myshopify.com domain.
 * Prevents open redirects and SSRF attacks.
 */
function isValidShopDomain(shop: string): boolean {
  // Must match: store-name.myshopify.com
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

// ─── GET /api/shopify/connect ────────────────────────────────
//
// Query params:
//   client_id  — agency-scoped client identifier
//   shop       — Shopify store domain (e.g. "my-store.myshopify.com")
//
// Flow:
//   1. Validate session
//   2. Validate shop domain + check for existing connection
//   3. Generate CSRF nonce, persist to DB
//   4. Redirect to Shopify OAuth consent screen
// ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const clientId = searchParams.get("client_id");
  const shop = searchParams.get("shop");

  if (!clientId || clientId.trim().length === 0) {
    return jsonError("Missing required query parameter: client_id", 400);
  }

  if (!shop || !isValidShopDomain(shop)) {
    return jsonError(
      "Missing or invalid shop parameter. Must be a valid myshopify.com domain.",
      400,
    );
  }

  // ── Authenticate ──────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonError("Unauthorized — valid session required", 401);
  }

  // ── Check for existing connection ─────────────────────────
  const { data: existingStore } = await supabase
    .from("shopify_stores")
    .select("id, is_active")
    .eq("user_id", user.id)
    .eq("client_id", clientId.trim())
    .maybeSingle();

  if (existingStore?.is_active) {
    return jsonError(
      "This client already has an active Shopify store connection. Disconnect first.",
      409,
    );
  }

  // ── Generate & persist CSRF state ─────────────────────────
  const state = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

  const { error: stateError } = await supabase
    .from("shopify_oauth_states")
    .insert({
      user_id: user.id,
      client_id: clientId.trim(),
      shop_domain: shop,
      state,
      expires_at: expiresAt,
    });

  if (stateError) {
    console.error("[shopify/connect] State insert failed:", stateError.message);
    return jsonError("Failed to initiate Shopify OAuth flow", 500);
  }

  // ── Build Shopify OAuth URL ───────────────────────────────
  const apiKey = env("SHOPIFY_API_KEY");
  const redirectUri = env("SHOPIFY_REDIRECT_URI");

  const oauthUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  oauthUrl.searchParams.set("client_id", apiKey);
  oauthUrl.searchParams.set("scope", REQUIRED_SCOPES.join(","));
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("state", state);

  return NextResponse.redirect(oauthUrl.toString());
}
