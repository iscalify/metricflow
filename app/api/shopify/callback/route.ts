import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptShopifyToken } from "@/lib/shopify/encryption";

// ─── Types ───────────────────────────────────────────────────

interface ShopifyTokenResponse {
  access_token: string;
  scope: string;
}

interface ShopifyShopInfo {
  shop: {
    id: number;
    name: string;
    email: string;
    domain: string;
    myshopify_domain: string;
    plan_name: string;
    currency: string;
  };
}

// ─── Constants ───────────────────────────────────────────────

const DASHBOARD_PATH = "/dashboard";

// ─── Helpers ─────────────────────────────────────────────────

function env(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
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

/**
 * Verify the HMAC signature from Shopify.
 * Shopify signs the callback query params with the app secret.
 */
function verifyHmac(query: URLSearchParams): boolean {
  const hmac = query.get("hmac");
  if (!hmac) return false;

  // Build the message from all params except 'hmac'
  const params = new URLSearchParams();
  query.forEach((value, key) => {
    if (key !== "hmac") params.set(key, value);
  });

  // Sort params alphabetically
  const sortedParams = new URLSearchParams(
    [...params.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );

  const message = sortedParams.toString();
  const secret = env("SHOPIFY_API_SECRET");
  const digest = createHmac("sha256", secret).update(message).digest("hex");

  return digest === hmac;
}

/**
 * Exchange the authorization code for a permanent access token.
 */
async function exchangeCodeForToken(
  shop: string,
  code: string,
): Promise<ShopifyTokenResponse> {
  const url = `https://${shop}/admin/oauth/access_token`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env("SHOPIFY_API_KEY"),
      client_secret: env("SHOPIFY_API_SECRET"),
      code,
    }),
  });

  const body = await res.json();

  if (!res.ok || !body.access_token) {
    throw new Error(
      `Shopify token exchange failed: ${body.error_description ?? body.error ?? res.statusText}`,
    );
  }

  return body as ShopifyTokenResponse;
}

/**
 * Fetch shop info using the access token.
 */
async function fetchShopInfo(
  shop: string,
  accessToken: string,
): Promise<ShopifyShopInfo["shop"]> {
  const url = `https://${shop}/admin/api/2024-10/shop.json`;

  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
    },
  });

  const body = await res.json();

  if (!res.ok || !body.shop) {
    throw new Error(
      `Failed to fetch shop info: ${body.errors ?? res.statusText}`,
    );
  }

  return (body as ShopifyShopInfo).shop;
}

// ─── GET /api/shopify/callback ───────────────────────────────
//
// Shopify redirects here with ?code=...&hmac=...&shop=...&state=...
//
// Flow:
//   1. Verify HMAC signature (integrity check from Shopify)
//   2. Validate code + state + shop params
//   3. Authenticate user session
//   4. Validate state from DB (CSRF check + expiry)
//   5. Exchange code → permanent access token
//   6. Fetch shop info
//   7. Store shop + encrypted token
//   8. Delete used state entry
//   9. Redirect to dashboard
// ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const shop = searchParams.get("shop");

  // ── 1. Verify HMAC ────────────────────────────────────────
  if (!verifyHmac(searchParams)) {
    console.error("[shopify/callback] HMAC verification failed");
    return dashboardRedirect(request, {
      shopify_error: "invalid_hmac",
      message: "Request signature verification failed",
    });
  }

  // ── 2. Validate params ────────────────────────────────────
  if (!code || !state || !shop) {
    return dashboardRedirect(request, {
      shopify_error: "invalid_request",
      message: "Missing code, state, or shop parameter",
    });
  }

  // Validate shop domain
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
    return dashboardRedirect(request, {
      shopify_error: "invalid_shop",
      message: "Invalid shop domain",
    });
  }

  // ── 3. Authenticate user ──────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return dashboardRedirect(request, {
      shopify_error: "unauthorized",
      message: "Session expired — please log in and try again",
    });
  }

  // ── 4. Validate state (CSRF check) ───────────────────────
  const { data: stateRow, error: stateLookupError } = await supabase
    .from("shopify_oauth_states")
    .select("id, user_id, client_id, shop_domain, expires_at")
    .eq("state", state)
    .maybeSingle();

  if (stateLookupError || !stateRow) {
    console.error("[shopify/callback] State lookup failed:", stateLookupError?.message);
    return dashboardRedirect(request, {
      shopify_error: "invalid_state",
      message: "Invalid or expired OAuth state",
    });
  }

  // Check expiry
  if (new Date(stateRow.expires_at) < new Date()) {
    await supabase.from("shopify_oauth_states").delete().eq("id", stateRow.id);
    return dashboardRedirect(request, {
      shopify_error: "expired_state",
      message: "OAuth session expired — please try again",
    });
  }

  // Verify state belongs to this user and shop
  if (stateRow.user_id !== user.id || stateRow.shop_domain !== shop) {
    return dashboardRedirect(request, {
      shopify_error: "state_mismatch",
      message: "OAuth state mismatch — please try again",
    });
  }

  const clientId = stateRow.client_id;

  // ── 5. Exchange code for access token ─────────────────────
  let tokenData: ShopifyTokenResponse;
  try {
    tokenData = await exchangeCodeForToken(shop, code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Token exchange failed";
    console.error("[shopify/callback] Token exchange error:", msg);
    return dashboardRedirect(request, {
      shopify_error: "token_exchange_failed",
      message: msg,
    });
  }

  // ── 6. Fetch shop info ────────────────────────────────────
  let shopInfo: ShopifyShopInfo["shop"];
  try {
    shopInfo = await fetchShopInfo(shop, tokenData.access_token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch shop info";
    console.error("[shopify/callback] Shop info error:", msg);
    // Continue anyway — we at least have the shop domain
    shopInfo = {
      id: 0,
      name: shop.replace(".myshopify.com", ""),
      email: "",
      domain: shop,
      myshopify_domain: shop,
      plan_name: "",
      currency: "",
    };
  }

  // ── 7. Store shop + encrypted token (via admin client) ────
  const adminClient = createAdminClient();

  // Upsert the Shopify store
  const { data: storeRow, error: storeError } = await adminClient
    .from("shopify_stores")
    .upsert(
      {
        user_id: user.id,
        client_id: clientId,
        shop_domain: shop,
        shop_name: shopInfo.name,
        shop_id: String(shopInfo.id),
        is_active: true,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id,client_id" },
    )
    .select("id")
    .single();

  if (storeError || !storeRow) {
    console.error("[shopify/callback] Store upsert error:", storeError?.message);
    return dashboardRedirect(request, {
      shopify_error: "store_error",
      message: "Failed to store Shopify connection",
    });
  }

  // Encrypt and store the access token
  const encryptedToken = encryptShopifyToken(tokenData.access_token);

  const { error: tokenError } = await adminClient.from("shopify_tokens").upsert(
    {
      shopify_store_id: storeRow.id,
      access_token_enc: encryptedToken,
      scopes: tokenData.scope,
    },
    { onConflict: "shopify_store_id" },
  );

  if (tokenError) {
    console.error("[shopify/callback] Token upsert error:", tokenError.message);
    return dashboardRedirect(request, {
      shopify_error: "token_error",
      message: "Failed to store access token",
    });
  }

  // ── 8. Clean up state ─────────────────────────────────────
  await supabase.from("shopify_oauth_states").delete().eq("id", stateRow.id);

  // ── 9. Redirect to dashboard ──────────────────────────────
  return dashboardRedirect(request, {
    shopify_connected: "true",
    shop_name: shopInfo.name || shop,
  });
}
