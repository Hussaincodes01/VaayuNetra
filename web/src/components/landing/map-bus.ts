"use client";

// Tiny event bus between the scroll-driven sections and the single fixed map behind the page.

export type MapScene =
  | { kind: "hero"; progress: number }
  | { kind: "site"; index: number }
  | { kind: "idle" };

type Listener = (scene: MapScene) => void;

let current: MapScene = { kind: "hero", progress: 0 };
const listeners = new Set<Listener>();

export function setMapScene(scene: MapScene): void {
  const same =
    scene.kind === current.kind &&
    (scene.kind !== "site" ||
      (current.kind === "site" && current.index === scene.index)) &&
    (scene.kind !== "hero" ||
      (current.kind === "hero" &&
        Math.abs(current.progress - scene.progress) < 1e-3));
  if (same) return;
  current = scene;
  listeners.forEach((l) => l(scene));
}

export function getMapScene(): MapScene {
  return current;
}

export function subscribeMapScene(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
