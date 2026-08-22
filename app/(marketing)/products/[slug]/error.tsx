"use client";

import { useEffect } from "react";
import { Section } from "@/components/layout/Section";
import { ErrorState } from "@/components/ui/ErrorState";

export default function ProductError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Wire this up to Sentry (see the SEO/security architecture doc) once available.
    console.error(error);
  }, [error]);

  return (
    <Section>
      <ErrorState
        title="This product didn't load"
        description="We couldn't reach pricing for this product just now — it may have been removed, or a store's feed is temporarily unavailable."
        onRetry={reset}
      />
    </Section>
  );
}
