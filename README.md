# Frontend Component Library

Reusable UI for the price-comparison platform. Every component here is
**presentational**: it receives typed data through props and reports actions
through callback props. None of them fetch data and none of them contain
sample/hard-coded product data — the only path data can take into the UI is
`lib/api.ts` → a page/server component → props. That's what satisfies
"production data must come from the backend, not hard-coded," and it's also
what keeps every component genuinely reusable and easy to test in isolation.

## Design system

- **Colors are functional, not decorative.** `jade` = price dropped/savings,
  `vermilion` = price rose/urgent, `saffron` = the brand accent, used for the
  "cheapest offer" and active-state highlighting. `ink`/`paper` are the
  dark/light surface pair. See `tailwind.config.ts`.
- **Three type roles**: `font-display` (headlines, used sparingly),
  `font-sans` (everything else), `font-mono` (`.font-tabular` utility — every
  price, discount %, and chart axis uses tabular figures so digits align
  when scanning a comparison table; this is a functional choice tied to the
  product, not decoration).
- **Signature element**: the diagonal corner-ribbon discount badge
  (`DiscountBadge variant="ribbon"` in `PriceBadges.tsx`) — a price-tag fold,
  reserved for the one standout offer on a card. Everywhere else uses the
  quieter pill badge, so the ribbon stays meaningful.
- **Motion is restrained and functional**: entrance fades/rises, a spring pop
  on the wishlist heart, an animated price-history line draw-in, staggered
  grid entrance. Every animated component reads `useReducedMotionSafe()`
  (`lib/motion.ts`) and collapses to a near-instant fade when the user has
  reduced motion enabled — plus a global CSS safety net in
  `styles/globals.css`.

### Wiring fonts

Set the three CSS variables in `app/layout.tsx` with `next/font`, e.g.:

```
import { Fraunces, Inter, IBM_Plex_Mono } from "next/font/google";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-mono" });

// <html className={`${display.variable} ${sans.variable} ${mono.variable}`}>
```

Until that's wired up, `tailwind.config.ts` falls back to system fonts, so
the app still looks correct.

## Folder structure

```
components/
  ui/           Button, Input, Modal, Toast, Skeleton, EmptyState, ErrorState
  layout/       Header, Navigation, Footer
  search/       SearchBar, SearchSuggestions
  product/      ProductCard, ProductGrid, MerchantPriceTable, PriceInsights,
                BuyButton, PriceHistoryChart
  badges/       PriceBadge, DiscountBadge, CheapestBadge
  merchant/     MerchantLogo, MerchantCard
  deals/        DealCard
  category/     CategoryCard
  filters/      Filters, SortMenu
  wishlist/     WishlistButton
  alerts/       PriceAlertButton (+ its own modal)
  assistant/    AIChat, AIChatLauncher
lib/
  types.ts      Every domain type components accept as props
  utils.ts      cn(), formatPrice(), getCheapestOffer(), etc.
  api.ts        The ONLY module that calls the backend — pages use this
  motion.ts     Shared animation variants + useReducedMotionSafe()
hooks/
  useDebounce.ts
  useClickOutside.ts
styles/globals.css
tailwind.config.ts · tsconfig.json · postcss.config.js · package.json
```

## Usage pattern

A page fetches with `lib/api.ts` and passes the result straight into a
component — no adapter layer, no local mock data:

```tsx
// app/(marketing)/search/page.tsx — Server Component
import { api } from "@/lib/api";
import { ProductGrid } from "@/components/product/ProductGrid";

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const result = await api.search({ query: searchParams.q ?? "" });
  return <ProductGrid products={result.products} />;
}
```

Interactive flows (wishlist toggle, price alerts, the assistant) live in a
small Client Component wrapper that owns state and calls `api.*`, then
passes callbacks down — keeping the presentational components in this
library untouched by data-fetching concerns:

```tsx
"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { ProductGrid } from "@/components/product/ProductGrid";
import type { Product } from "@/lib/types";

export function WishlistableGrid({ initialProducts }: { initialProducts: Product[] }) {
  const [products, setProducts] = useState(initialProducts);

  async function toggleWishlist(product: Product) {
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, isWishlisted: !p.isWishlisted } : p)),
    );
    if (product.isWishlisted) await api.removeFromWishlist(product.id);
    else await api.addToWishlist(product.id);
  }

  return <ProductGrid products={products} onToggleWishlist={toggleWishlist} />;
}
```

`ToastProvider` (from `components/ui/Toast.tsx`) wraps the app once in the
root layout (see Setup below) so any component tree can call `useToast()`.

## Setup

```
npm install
npm run dev
```

In `app/layout.tsx`, import the stylesheet once and mount `ToastProvider`
around `children` so any component tree can call `useToast()`:

```tsx
import "@/styles/globals.css";
import { ToastProvider } from "@/components/ui/Toast";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
```

`NEXT_PUBLIC_API_BASE_URL` (optional) points `lib/api.ts` at your API; it
defaults to the same-origin `/api`, matching Next.js route handlers.

**Image domains**: every product/merchant/category image goes through
`next/image` for optimization, which means every external host that could
appear in `imageUrl`/`logoUrl` fields must be added to `images.remotePatterns`
in `next.config.js`. Since feed images come from many different merchant CDNs
that aren't all known in advance, either widen `remotePatterns` deliberately
(e.g. per affiliate network's documented CDN hostnames) or — the more robust
option as the merchant list grows — proxy/cache images through your own
domain (Cloudflare Images or an R2-backed image proxy) so this config never
needs to change per merchant.

## Accessibility notes

- Every interactive element has a visible focus ring (`:focus-visible` in
  `globals.css`) and an accessible name (`aria-label` where there's no
  visible text).
- `SearchBar`/`SearchSuggestions` implement the ARIA combobox/listbox
  pattern with full keyboard support (arrow keys, Enter, Escape).
- `Modal` and `SortMenu` use Radix primitives for focus trapping, outside
  click, and Escape-to-close — don't reimplement that logic elsewhere.
- `MerchantPriceTable` is a real `<table>` with `scope="col"/"row"` so screen
  readers can navigate it as data, not just styled boxes. It replaced the
  earlier `ComparisonTable`, which had no freshness awareness — every row
  here is labelled with how recently that price was verified.
