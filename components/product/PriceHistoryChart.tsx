"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import type { PriceHistoryPoint } from "@/lib/types";
import { cn, formatPrice } from "@/lib/utils";
import { useReducedMotionSafe } from "@/lib/motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

export interface PriceHistoryChartProps {
  data: PriceHistoryPoint[];
  isLoading?: boolean;
  height?: number;
  className?: string;
}

function formatAxisDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as PriceHistoryPoint | undefined;
  if (!point) return null;

  return (
    <div className="rounded-md border border-ink-100 bg-paper px-3 py-2 text-xs shadow-card-hover dark:border-ink-700 dark:bg-ink-900">
      <p className="text-ink-400">{formatAxisDate(point.date)}</p>
      <p className="font-tabular font-semibold text-ink dark:text-paper">{formatPrice(point.price)}</p>
      {!point.inStock && <p className="text-vermilion-500">Out of stock</p>}
    </div>
  );
}

export function PriceHistoryChart({ data, isLoading, height = 260, className }: PriceHistoryChartProps) {
  const reduced = useReducedMotionSafe();

  if (isLoading) {
    return <Skeleton className={cn("w-full rounded-lg", className)} style={{ height }} />;
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title="No price history yet"
        description="We'll start charting this product's price as soon as we see a change."
        className={className}
      />
    );
  }

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="priceHistoryFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E2A33B" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#E2A33B" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#8B889A" strokeOpacity={0.25} />
          <XAxis
            dataKey="date"
            tickFormatter={formatAxisDate}
            tick={{ fontSize: 11, fill: "#8B889A" }}
            stroke="#8B889A"
            tickLine={false}
            axisLine={false}
            minTickGap={32}
          />
          <YAxis
            tickFormatter={(value: number) => formatPrice(value, true)}
            tick={{ fontSize: 11, fill: "#8B889A" }}
            stroke="#8B889A"
            tickLine={false}
            axisLine={false}
            width={64}
            domain={["auto", "auto"]}
          />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="price"
            stroke="#C6862A"
            strokeWidth={2}
            fill="url(#priceHistoryFill)"
            isAnimationActive={!reduced}
            animationDuration={900}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: "#C6862A" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
