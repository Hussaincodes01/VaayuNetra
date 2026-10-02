"use client";

// "Ground view": nearest Mapillary 360° image to a landfill, in a modal dialog.
// Rendered only when NEXT_PUBLIC_MAPILLARY_TOKEN is set; mapillary-js loads on first open.

import { Camera, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { Site } from "@/lib/landing-types";
import { usePlaces } from "./format";

type State = "idle" | "loading" | "ready" | "none";

async function nearestImageId(
  token: string,
  lat: number,
  lon: number,
): Promise<string | null> {
  for (const d of [0.01, 0.03]) {
    const bbox = [lon - d, lat - d, lon + d, lat + d]
      .map((v) => v.toFixed(5))
      .join(",");
    const url = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}&fields=id,computed_geometry,is_pano&bbox=${bbox}&limit=50`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: {
        id: string;
        is_pano?: boolean;
        computed_geometry?: { coordinates: [number, number] };
      }[];
    };
    const imgs = (json.data ?? []).filter((i) => i.computed_geometry);
    if (!imgs.length) continue;
    const dist = (i: (typeof imgs)[number]) => {
      const [x, y] = i.computed_geometry!.coordinates;
      return (x - lon) ** 2 + (y - lat) ** 2 - (i.is_pano ? 1e-6 : 0);
    };
    imgs.sort((a, b) => dist(a) - dist(b));
    return imgs[0].id;
  }
  return null;
}

export function GroundView({ token, site }: { token: string; site: Site }) {
  const t = useTranslations("Field");
  const places = usePlaces();
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<{ remove: () => void } | null>(null);
  const [state, setState] = useState<State>("idle");

  const close = () => dialog.current?.close();

  const open = async () => {
    dialog.current?.showModal();
    setState("loading");
    try {
      const [id, mapillary] = await Promise.all([
        nearestImageId(token, site.lat, site.lon),
        import("mapillary-js"),
        import("mapillary-js/dist/mapillary.css"),
      ]);
      if (!id || !host.current) {
        setState("none");
        return;
      }
      viewer.current?.remove();
      viewer.current = new mapillary.Viewer({
        accessToken: token,
        container: host.current,
        imageId: id,
      });
      setState("ready");
    } catch {
      setState("none");
    }
  };

  useEffect(() => {
    const d = dialog.current;
    const onClose = () => {
      viewer.current?.remove();
      viewer.current = null;
      setState("idle");
    };
    d?.addEventListener("close", onClose);
    return () => d?.removeEventListener("close", onClose);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-background/60 px-3 py-2 text-sm font-medium backdrop-blur transition-colors hover:bg-white/10"
      >
        <Camera className="size-4" aria-hidden /> {t("groundView")}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`gv-${site.slug}`}
        className="m-auto h-[80svh] w-[min(1100px,94vw)] rounded-xl border border-white/10 bg-card p-0 text-foreground backdrop:bg-black/70"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h3 id={`gv-${site.slug}`} className="font-heading font-semibold">
              {t("groundViewTitle", {
                site: places.site(site.slug, site.name),
              })}
            </h3>
            <button
              type="button"
              onClick={close}
              className="rounded-md p-1.5 hover:bg-white/10"
              aria-label={t("close")}
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="relative flex-1">
            <div ref={host} className="absolute inset-0" />
            {state === "none" && (
              <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-muted-foreground">
                {t("groundViewNone")}
              </p>
            )}
            {state === "loading" && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                aria-busy="true"
              >
                <span className="size-8 animate-spin rounded-full border-2 border-signal border-t-transparent motion-reduce:animate-none" />
              </div>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
