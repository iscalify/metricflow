"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setResult(null);

    try {
      const res = await fetch("/api/meta/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const body = await res.json();

      if (!res.ok) {
        setResult(`Error: ${body.error ?? "Sync failed"}`);
      } else {
        const total = body.results?.reduce(
          (sum: number, r: { synced: number }) => sum + r.synced,
          0,
        );
        setResult(`Synced ${total} insight rows`);
        // Reload the page to show updated data
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch {
      setResult("Network error — check your connection");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <span
          className={`text-sm ${
            result.startsWith("Error") ? "text-red-600" : "text-green-600"
          }`}
        >
          {result}
        </span>
      )}
      <Button onClick={handleSync} disabled={syncing} variant="outline">
        <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Syncing…" : "Sync Data"}
      </Button>
    </div>
  );
}
