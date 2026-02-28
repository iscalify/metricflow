"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Unplug } from "lucide-react";

export function DisconnectButton({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleDisconnect() {
    if (!confirm("Are you sure you want to disconnect this Meta Ad Account?")) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/meta/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });

      if (res.ok) {
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleDisconnect}
      disabled={loading}
    >
      <Unplug className="mr-1 h-3 w-3" />
      {loading ? "Disconnecting..." : "Disconnect"}
    </Button>
  );
}
