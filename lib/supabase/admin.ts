import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client using the SERVICE_ROLE key.
 *
 * ⚠️  Bypasses RLS — use ONLY in:
 *   • Route Handlers (server-side)
 *   • Background jobs / cron
 *
 * NEVER import this in client components or expose to the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
