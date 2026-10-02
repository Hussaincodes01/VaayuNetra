"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useState } from "react";

let registered = false;
export function registerGsap(): typeof gsap {
  if (!registered && typeof window !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
    registered = true;
  }
  return gsap;
}

export { gsap, ScrollTrigger };

const QUERY = "(prefers-reduced-motion: reduce)";

/** True when the visitor asked for reduced motion. False during SSR and the first client render. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}

/** Narrow-screen layout (map above text). */
export function useIsNarrow(breakpoint = 768): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);
  return narrow;
}

const INTERACTION_EVENTS = [
  "pointermove",
  "pointerdown",
  "wheel",
  "touchstart",
  "keydown",
  "scroll",
] as const;

/**
 * True after the visitor first interacts with the page (or after `fallbackMs`). Heavy WebGL
 * decoration (three.js, Mapbox) mounts then, so it never blocks the main thread during load.
 */
export function useAfterFirstInteraction(fallbackMs = 6000): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    const go = () => setReady(true);
    const timer = window.setTimeout(go, fallbackMs);
    const opts = { once: true, passive: true } as const;
    INTERACTION_EVENTS.forEach((e) => window.addEventListener(e, go, opts));
    return () => {
      window.clearTimeout(timer);
      INTERACTION_EVENTS.forEach((e) => window.removeEventListener(e, go));
    };
  }, [ready, fallbackMs]);
  return ready;
}
