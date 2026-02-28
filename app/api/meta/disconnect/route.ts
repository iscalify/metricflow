import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/meta/disconnect
 *
 * Disconnects the Meta Ad Account for a given client.
 * Deletes the token and deactivates the ad account.
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
    return NextResponse.json(
      { error: "Missing client_id" },
      { status: 400 },
    );
  }

  const adminClient = createAdminClient();

  // Find the ad account
  const { data: account } = await adminClient
    .from("meta_ad_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("client_id", clientId)
    .maybeSingle();

  if (account) {
    // Delete token first (FK constraint)
    await adminClient
      .from("meta_tokens")
      .delete()
      .eq("meta_ad_account_id", account.id);

    // Delete the ad account
    await adminClient
      .from("meta_ad_accounts")
      .delete()
      .eq("id", account.id);
  }

  return NextResponse.json({ success: true });
}
