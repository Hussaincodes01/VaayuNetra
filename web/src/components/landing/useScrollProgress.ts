"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { registerGsap, ScrollTrigger } from "./motion";

/**
 * Calls onProgress(0..1) as `ref` scrolls from its top reaching the viewport top to its bottom
 * reaching the viewport bottom (the span of a tall section with a sticky inner panel).
 */
export function useScrollProgress(
  ref: RefObject<HTMLElement | null>,
  onProgress: (progress: number) => void,
  enabled = true,
): void {
  const callback = useRef(onProgress);
  callback.current = onProgress;

  useEffect(() => {
    if (!enabled || !ref.current) return;
    registerGsap();
    const trigger = ScrollTrigger.create({
      trigger: ref.current,
      start: "top top",
      end: "bottom bottom",
      onUpdate: (self) => callback.current(self.progress),
      onRefresh: (self) => callback.current(self.progress),
    });
    callback.current(trigger.progress);
    return () => trigger.kill();
  }, [ref, enabled]);
}

/** True once the element has come within `margin` of the viewport (stays true). */
export function useInView(
  ref: RefObject<HTMLElement | null>,
  margin = "0px 0px -15% 0px",
): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, seen]);
  return seen;
}
