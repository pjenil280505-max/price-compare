"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/Skeleton";
import type { PriceHistoryPoint } from "@/lib/types";

/**
 * Recharts pulls in D3 and is one of the largest dependencies in the
 * bundle. It sits inside a tab that most visitors never open, so loading
 * it eagerly costs every visitor for a minority feature.
 *
 * ssr:false because the chart measures its container to size the SVG —
 * server-rendering it produces markup that is immediately discarded and
 * replaced, which is wasted bytes and a layout shift.
 *
 * The skeleton reserves the exact final height so nothing below it moves
 * when the chart arrives (CLS).
 */
const PriceHistoryChart = dynamic(
  () => import("./PriceHistoryChart").then((m) => m.PriceHistoryChart),
  {
    ssr: false,
    loading: () => <Skeleton className="w-full rounded-lg" style={{ height: 260 }} />,
  },
);

export function PriceHistoryChartLazy(props: {
  data: PriceHistoryPoint[];
  isLoading?: boolean;
  height?: number;
  className?: string;
}) {
  return <PriceHistoryChart {...props} />;
}
