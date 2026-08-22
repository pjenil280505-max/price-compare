import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, IBM_Plex_Mono } from "next/font/google";
import "@/styles/globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/seo/site";
import { serializeJsonLd, buildOrganizationJsonLd } from "@/lib/seo/structuredData";

// display: "swap" so text paints immediately in a fallback face rather
// than being invisible while the webfont loads — the single biggest
// avoidable contributor to a poor Largest Contentful Paint.
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600"],
  display: "swap",
  preload: true,
});
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap", preload: true });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-mono",
  display: "swap",
  // Only used for prices/tabular figures, never for above-the-fold body
  // text, so preloading it would compete with fonts that are.
  preload: false,
});

export const metadata: Metadata = {
  // Makes every relative canonical/OG URL resolve to an absolute one.
  // Without this Next emits relative OG URLs, which most crawlers ignore.
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE_NAME} — Every price, every store, one search`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Every price, every store, one search`,
    description: SITE_DESCRIPTION,
    locale: "en_IN",
    url: "/",
  },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Not restricting maximumScale: capping zoom breaks pinch-zoom for
  // low-vision users and is an accessibility failure.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF9F6" },
    { media: "(prefers-color-scheme: dark)", color: "#14131C" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-IN"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Warms the TLS connection to the image CDN before the first
            product image is requested. */}
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} crossOrigin="" />
        <script
          type="application/ld+json"
          // Site-level Organization node, emitted once.
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(buildOrganizationJsonLd({ siteUrl: siteUrl(), name: SITE_NAME })),
          }}
        />
      </head>
      <body className="min-h-screen bg-paper text-ink antialiased dark:bg-ink-950 dark:text-paper">
        {/* Keyboard users land here first and can jump past the header and
            nav straight to content. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-ink focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-paper dark:focus:bg-saffron dark:focus:text-ink-950"
        >
          Skip to content
        </a>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
