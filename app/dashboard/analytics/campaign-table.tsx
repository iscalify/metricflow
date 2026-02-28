import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface Campaign {
  campaign_id: string;
  campaign_name: string;
  objective: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  ctr: number;
  cpc: number;
  conversions: number;
  conversionValue: number;
  costPerConversion: number;
  days: number;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CampaignTable({ campaigns }: { campaigns: Campaign[] }) {
  if (campaigns.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No campaign data available.
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[200px]">Campaign</TableHead>
            <TableHead className="text-right">Impressions</TableHead>
            <TableHead className="text-right">Clicks</TableHead>
            <TableHead className="text-right">CTR</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">CPC</TableHead>
            <TableHead className="text-right">Conversions</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">ROAS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaigns.map((c) => {
            const roas = c.spend > 0 ? c.conversionValue / c.spend : 0;
            return (
              <TableRow key={c.campaign_id}>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{c.campaign_name}</span>
                    {c.objective && (
                      <Badge variant="secondary" className="w-fit text-xs">
                        {c.objective}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatNumber(c.impressions)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatNumber(c.clicks)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {c.ctr.toFixed(2)}%
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(c.spend)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(c.cpc)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatNumber(c.conversions)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(c.conversionValue)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {roas.toFixed(2)}x
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
