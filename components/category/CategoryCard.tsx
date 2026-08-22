import Image from "next/image";
import Link from "next/link";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface CategoryCardProps {
  category: Category;
  className?: string;
}

export function CategoryCard({ category, className }: CategoryCardProps) {
  return (
    <Link
      href={`/categories/${category.slug}`}
      className={cn(
        "group relative flex aspect-[4/5] shrink-0 flex-col justify-end overflow-hidden rounded-lg bg-ink-100 dark:bg-ink-800",
        className,
      )}
    >
      <Image
        src={category.imageUrl}
        alt=""
        fill
        sizes="(min-width: 1024px) 18vw, 40vw"
        className="object-cover transition-transform duration-300 ease-out group-hover:scale-105"
      />
      <div className="relative bg-gradient-to-t from-ink-950/80 via-ink-950/20 to-transparent p-4 pt-10">
        <h3 className="text-sm font-semibold text-white">{category.name}</h3>
        {category.productCount != null && (
          <p className="text-xs text-white/75">{category.productCount.toLocaleString("en-IN")} products</p>
        )}
      </div>
    </Link>
  );
}
