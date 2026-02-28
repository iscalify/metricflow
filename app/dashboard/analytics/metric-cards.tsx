import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Eye,
  MousePointerClick,
  DollarSign,
  Users,
  Target,
  TrendingUp,
  BarChart3,
  ShoppingCart,
  Percent,
} from "lucide-react";

interface MetricCardsProps {
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  ctr: number;
  cpc: number;
  conversions: number;
  conversionValue: number;
  roas: number;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(n: number): string {
  return `${n.toFixed(2)}%`;
}

export function MetricCards(props: MetricCardsProps) {
  const metrics = [
    {
      title: "Impressions",
      value: formatNumber(props.impressions),
      icon: Eye,
      description: "Total ad impressions",
    },
    {
      title: "Clicks",
      value: formatNumber(props.clicks),
      icon: MousePointerClick,
      description: "Total ad clicks",
    },
    {
      title: "Spend",
      value: formatCurrency(props.spend),
      icon: DollarSign,
      description: "Total ad spend",
    },
    {
      title: "Reach",
      value: formatNumber(props.reach),
      icon: Users,
      description: "Unique users reached",
    },
    {
      title: "CTR",
      value: formatPercent(props.ctr),
      icon: Percent,
      description: "Click-through rate",
    },
    {
      title: "CPC",
      value: formatCurrency(props.cpc),
      icon: Target,
      description: "Cost per click",
    },
    {
      title: "Conversions",
      value: formatNumber(props.conversions),
      icon: ShoppingCart,
      description: "Total conversions",
    },
    {
      title: "Revenue",
      value: formatCurrency(props.conversionValue),
      icon: TrendingUp,
      description: "Conversion value",
    },
    {
      title: "ROAS",
      value: `${props.roas.toFixed(2)}x`,
      icon: BarChart3,
      description: "Return on ad spend",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {metrics.map((m) => (
        <Card key={m.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {m.title}
            </CardTitle>
            <m.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{m.value}</div>
            <p className="text-xs text-muted-foreground">{m.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
