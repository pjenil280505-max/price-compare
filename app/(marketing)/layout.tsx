import { SiteHeader } from "@/components/layout/SiteHeader";
import { Footer } from "@/components/layout/Footer";
import { PageTransition } from "@/components/motion/PageTransition";

const footerGroups = [
  {
    title: "Shop",
    links: [
      { label: "Deals", href: "/deals" },
      { label: "Categories", href: "/categories" },
      { label: "Stores", href: "/stores" },
      { label: "AI Assistant", href: "/assistant" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Wishlist", href: "/wishlist" },
      { label: "Price alerts", href: "/alerts" },
      { label: "Sign in", href: "/login" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Affiliate disclosure", href: "/affiliate-disclosure" },
      { label: "Price disclaimer", href: "/price-disclaimer" },
      { label: "Cookies", href: "/cookies" },
    ],
  },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
      <Footer groups={footerGroups} />
    </div>
  );
}
