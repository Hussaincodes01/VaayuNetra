"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import type { MapSite } from "./SitesMap";
import { STATUS_COLOUR } from "./status";

/** Mapbox map of all sites; each site is a keyboard-focusable marker button that opens it. */
export default function MapboxSitesMap({
  token,
  sites,
  hrefBase,
  label,
}: {
  token: string;
  sites: MapSite[];
  hrefBase: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!ref.current || !sites.length) return;
    mapboxgl.accessToken = token;
    const bounds = new mapboxgl.LngLatBounds();
    sites.forEach((s) => bounds.extend([s.lon, s.lat]));
    const map = new mapboxgl.Map({
      container: ref.current,
      style: "mapbox://styles/mapbox/standard",
      config: {
        basemap: { lightPreset: "night", showPointOfInterestLabels: false },
      },
      worldview: "IN",
      bounds,
      fitBoundsOptions: { padding: 80, maxZoom: 8 },
      cooperativeGestures: true,
    });
    map.on("error", () => undefined);
    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    const markers = sites.map((s) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "vayu-site-marker";
      el.style.setProperty("--status", STATUS_COLOUR[s.status]);
      el.setAttribute("aria-label", `${s.name}, ${s.city}`);
      el.title = s.name;
      el.addEventListener("click", () => router.push(`${hrefBase}/${s.slug}`));
      return new mapboxgl.Marker({ element: el })
        .setLngLat([s.lon, s.lat])
        .addTo(map);
    });
    return () => {
      markers.forEach((m) => m.remove());
      map.remove();
    };
  }, [token, sites, hrefBase, router]);

  return (
    <div
      ref={ref}
      className="absolute inset-0"
      role="region"
      aria-label={label}
    />
  );
}
