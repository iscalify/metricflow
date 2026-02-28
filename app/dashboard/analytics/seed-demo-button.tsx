"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Database } from "lucide-react";

export function SeedDemoButton() {
  const [seeding, setSeeding] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleSeed() {
    setSeeding(true);
    setResult(null);

    try {
      const res = await fetch("/api/meta/seed-demo", {
        method: "POST",
      });

      const body = await res.json();

      if (!res.ok) {
        setResult(`Error: ${body.error ?? "Failed to seed data"}`);
      } else {
        setResult(
          `Seeded ${body.total_rows} rows (${body.campaigns} campaigns × ${body.days} days)`,
        );
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch {
      setResult("Network error");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {result && (
        <span
          className={`text-sm ${
            result.startsWith("Error") ? "text-red-600" : "text-green-600"
          }`}
        >
          {result}
        </span>
      )}
      <Button onClick={handleSeed} disabled={seeding} variant="secondary">
        <Database className={`mr-2 h-4 w-4 ${seeding ? "animate-pulse" : ""}`} />
        {seeding ? "Seeding…" : "Load Demo Data"}
      </Button>
    </div>
  );
}
