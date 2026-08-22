"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { Category } from "@/lib/types";
import { fadeUp, staggerContainer, useReducedMotionSafe, withMotionPreference } from "@/lib/motion";
import { Container } from "@/components/layout/Container";
import { ConnectedSearchBar } from "@/components/search/ConnectedSearchBar";

export interface HeroProps {
  quickCategories: Category[];
}

export function Hero({ quickCategories }: HeroProps) {
  const reduced = useReducedMotionSafe();

  return (
    <div className="relative overflow-hidden border-b border-ink-100 bg-gradient-to-b from-saffron-50/60 to-paper dark:border-ink-800 dark:from-ink-800/40 dark:to-ink-950">
      <Container className="py-16 sm:py-20 lg:py-28">
        <motion.div
          variants={withMotionPreference(staggerContainer, reduced)}
          initial="hidden"
          animate="visible"
          className="mx-auto flex max-w-2xl flex-col items-center text-center"
        >
          <motion.h1
            variants={withMotionPreference(fadeUp, reduced)}
            className="font-display text-4xl font-semibold tracking-tight text-ink dark:text-paper sm:text-5xl lg:text-6xl"
          >
            Every price, every store,
            <br className="hidden sm:block" /> one search.
          </motion.h1>

          <motion.p
            variants={withMotionPreference(fadeUp, reduced)}
            className="mt-5 max-w-lg text-lg text-ink-500 dark:text-ink-300"
          >
            We track prices across every store we support so you don&apos;t have to —
            compare, watch a price drop, buy from whoever&apos;s cheapest today.
          </motion.p>

          <motion.div variants={withMotionPreference(fadeUp, reduced)} className="mt-8 w-full max-w-xl">
            <ConnectedSearchBar placeholder="Search for a phone, a brand, a category…" />
          </motion.div>

          {quickCategories.length > 0 && (
            <motion.div
              variants={withMotionPreference(fadeUp, reduced)}
              className="mt-6 flex flex-wrap items-center justify-center gap-2"
            >
              {quickCategories.map((category) => (
                <Link
                  key={category.id}
                  href={`/categories/${category.slug}`}
                  className="rounded-full border border-ink-200 bg-paper px-3.5 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:border-saffron-300 hover:text-ink dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300"
                >
                  {category.name}
                </Link>
              ))}
            </motion.div>
          )}
        </motion.div>
      </Container>
    </div>
  );
}
