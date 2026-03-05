import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, CheckCircle2, AlertCircle, Plus, BarChart3, ShoppingBag, Store } from "lucide-react";
import Link from "next/link";
import { DisconnectButton } from "./disconnect-button";
import { ShopifyDisconnectButton } from "./shopify-disconnect-button";
import { ShopifyConnectForm } from "./shopify-connect-form";

// Hardcoded for now — in production, this would come from a clients table
const DEMO_CLIENT_ID = "demo-client";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    meta_connected?: string;
    meta_error?: string;
    shopify_connected?: string;
    shopify_error?: string;
    message?: string;
    client_id?: string;
    account_name?: string;
    shop_name?: string;
  }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch connected Meta ad accounts for this user
  const { data: adAccounts } = await supabase
    .from("meta_ad_accounts")
    .select("id, meta_account_id, meta_account_name, client_id, is_active, connected_at")
    .eq("user_id", user!.id)
    .eq("is_active", true)
    .order("connected_at", { ascending: false });

  // Fetch connected Shopify stores for this user
  const { data: shopifyStores } = await supabase
    .from("shopify_stores")
    .select("id, shop_domain, shop_name, client_id, is_active, connected_at")
    .eq("user_id", user!.id)
    .eq("is_active", true)
    .order("connected_at", { ascending: false });

  const hasConnectedAccount = adAccounts && adAccounts.length > 0;
  const hasConnectedShopify = shopifyStores && shopifyStores.length > 0;

  return (
    <div className="space-y-6">
      {/* Meta Success banner */}
      {params.meta_connected === "true" && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <p className="text-sm">
            Successfully connected Meta Ad Account
            {params.account_name ? `: ${params.account_name}` : ""}
          </p>
        </div>
      )}

      {/* Shopify Success banner */}
      {params.shopify_connected === "true" && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <p className="text-sm">
            Successfully connected Shopify store
            {params.shop_name ? `: ${params.shop_name}` : ""}
          </p>
        </div>
      )}

      {/* Meta Error banner */}
      {params.meta_error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">
            {params.message ?? "Failed to connect Meta Ad Account"}
          </p>
        </div>
      )}

      {/* Shopify Error banner */}
      {params.shopify_error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">
            {params.message ?? "Failed to connect Shopify store"}
          </p>
        </div>
      )}

      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">
          Manage your platform connections and analytics
        </p>
      </div>

      <Separator />

      {/* ──────── Meta Ad Accounts ──────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Meta Ad Accounts</h3>
          {!hasConnectedAccount && (
            <a href={`/api/meta/connect?client_id=${DEMO_CLIENT_ID}`}>
              <Button>
                <Plus className="mr-1 h-4 w-4" />
                Connect Meta Ads
              </Button>
            </a>
          )}
        </div>

        {hasConnectedAccount ? (
          <div className="grid gap-4 md:grid-cols-2">
            {adAccounts.map((account) => (
              <Card key={account.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {account.meta_account_name ?? "Unnamed Account"}
                    </CardTitle>
                    <Badge variant="default" className="bg-green-600">
                      Connected
                    </Badge>
                  </div>
                  <CardDescription className="font-mono text-xs">
                    {account.meta_account_id}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Client: {account.client_id}</span>
                    <span>
                      Connected{" "}
                      {new Date(account.connected_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <Link href="/dashboard/analytics">
                      <Button variant="outline" size="sm">
                        <BarChart3 className="mr-1 h-4 w-4" />
                        View Analytics
                      </Button>
                    </Link>
                    <DisconnectButton clientId={account.client_id} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <ExternalLink className="mb-4 h-10 w-10 text-muted-foreground" />
              <h4 className="text-lg font-semibold">No accounts connected</h4>
              <p className="mb-6 max-w-sm text-sm text-muted-foreground">
                Connect your Meta Ad Account to start tracking campaign
                performance and syncing analytics data.
              </p>
              <a href={`/api/meta/connect?client_id=${DEMO_CLIENT_ID}`}>
                <Button size="lg">
                  <Plus className="mr-2 h-4 w-4" />
                  Connect Meta Ad Account
                </Button>
              </a>
            </CardContent>
          </Card>
        )}
      </div>

      <Separator />

      {/* ──────── Shopify Stores ──────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Shopify Stores</h3>
          {!hasConnectedShopify && (
            <ShopifyConnectForm clientId={DEMO_CLIENT_ID} />
          )}
        </div>

        {hasConnectedShopify ? (
          <div className="grid gap-4 md:grid-cols-2">
            {shopifyStores.map((store) => (
              <Card key={store.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <ShoppingBag className="h-4 w-4" />
                      {store.shop_name ?? store.shop_domain}
                    </CardTitle>
                    <Badge variant="default" className="bg-green-600">
                      Connected
                    </Badge>
                  </div>
                  <CardDescription className="font-mono text-xs">
                    {store.shop_domain}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Client: {store.client_id}</span>
                    <span>
                      Connected{" "}
                      {new Date(store.connected_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <ShopifyDisconnectButton clientId={store.client_id} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Store className="mb-4 h-10 w-10 text-muted-foreground" />
              <h4 className="text-lg font-semibold">No Shopify stores connected</h4>
              <p className="mb-6 max-w-sm text-sm text-muted-foreground">
                Connect your Shopify store to sync orders, revenue, and product analytics.
              </p>
              <ShopifyConnectForm clientId={DEMO_CLIENT_ID} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
