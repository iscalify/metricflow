import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/shopify/disconnect
 *
 * Disconnects the Shopify store for a given client.
 * Deletes the token and removes the store record.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const clientId = body.client_id;

  if (!clientId) {
    return NextResponse.json({ error: "Missing client_id" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // Find the Shopify store
  const { data: store } = await adminClient
    .from("shopify_stores")
    .select("id")
    .eq("user_id", user.id)
    .eq("client_id", clientId)
    .maybeSingle();

  if (store) {
    // Delete token first (FK constraint)
    await adminClient
      .from("shopify_tokens")
      .delete()
      .eq("shopify_store_id", store.id);

    // Delete the store record
    await adminClient
      .from("shopify_stores")
      .delete()
      .eq("id", store.id);
  }

  return NextResponse.json({ success: true });
}
