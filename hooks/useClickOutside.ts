"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Calls `onOutside` when a pointer event lands outside every ref in `refs`. */
export function useClickOutside(
  refs: RefObject<HTMLElement>[],
  onOutside: () => void,
  active = true,
): void {
  // Keeping the latest callback/refs in a ref means the subscription effect
  // below only needs to depend on `active` — callers can pass a fresh inline
  // function or array literal on every render without tearing down and
  // re-attaching the document listener each time.
  const stateRef = useRef({ refs, onOutside });
  stateRef.current = { refs, onOutside };

  useEffect(() => {
    if (!active) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const { refs: currentRefs, onOutside: currentOnOutside } = stateRef.current;
      const isInside = currentRefs.some((ref) => ref.current?.contains(target));
      if (!isInside) currentOnOutside();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [active]);
}
