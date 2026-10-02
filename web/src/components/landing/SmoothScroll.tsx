"use client";

import Lenis from "lenis";
import "lenis/dist/lenis.css";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { registerGsap, ScrollTrigger, useReducedMotion } from "./motion";

const LenisContext = createContext<Lenis | null>(null);

/** Lenis smooth scrolling driven by the GSAP ticker so ScrollTrigger pins stay in sync. Off for reduced motion. */
export function SmoothScroll({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [lenis, setLenis] = useState<Lenis | null>(null);

  useEffect(() => {
    const gsap = registerGsap();
    if (reduced) return;
    const instance = new Lenis({
      lerp: 0.085,
      wheelMultiplier: 0.9,
      anchors: true,
    });
    instance.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => instance.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    setLenis(instance);
    return () => {
      gsap.ticker.remove(tick);
      instance.destroy();
      setLenis(null);
    };
  }, [reduced]);

  return (
    <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>
  );
}

export function useLenis(): Lenis | null {
  return useContext(LenisContext);
}

/** Scroll to an element id, smoothly when Lenis is running. */
export function useScrollTo(): (id: string) => void {
  const lenis = useLenis();
  return (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset: 0, duration: 1.4 });
    else el.scrollIntoView({ behavior: "auto", block: "start" });
  };
}
