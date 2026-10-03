"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import { windArrow } from "@/components/landing/MapboxStage";
import type { EvidenceRow } from "@/lib/dashboard-shared";

type GeoData = mapboxgl.GeoJSONSourceSpecification["data"];

/** One flagged pass on 3D terrain: draped chip, plume outline, wind arrow, control point. */
export default function SiteEvidenceMap({
  token,
  site,
  evidence,
  wind,
  control,
  controlLabel,
  label,
}: {
  token: string;
  site: {
    slug: string;
    name: string;
    city: string;
    state: string;
    lat: number;
    lon: number;
  };
  evidence: EvidenceRow;
  wind: { u: number; v: number } | null;
  control: { lat: number; lon: number } | null;
  controlLabel: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: ref.current,
      style: "mapbox://styles/mapbox/standard-satellite",
      config: {
        basemap: { lightPreset: "day", showPointOfInterestLabels: false },
      },
      worldview: "IN",
      center: [site.lon, site.lat],
      zoom: 14.2,
      pitch: 58,
      bearing: -20,
      cooperativeGestures: true,
    });
    map.on("error", () => undefined);
    map.addControl(
      new mapboxgl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );
    const markers: mapboxgl.Marker[] = [];
    map.on("style.load", () => {
      map.addSource("dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
      map.setTerrain({ source: "dem", exaggeration: 1.6 });
      map.addSource("chip", {
        type: "image",
        url: evidence.rgb,
        coordinates: evidence.chipBounds as [
          [number, number],
          [number, number],
          [number, number],
          [number, number],
        ],
      });
      map.addLayer({
        id: "chip",
        type: "raster",
        source: "chip",
        slot: "middle",
        paint: { "raster-opacity": 0.95 },
      });
      if (evidence.plume) {
        map.addSource("plume", {
          type: "geojson",
          data: evidence.plume as unknown as GeoData,
        });
        map.addLayer({
          id: "plume-fill",
          type: "fill",
          source: "plume",
          slot: "middle",
          paint: {
            "fill-color": "#F59E0B",
            "fill-opacity": 0.55,
            "fill-emissive-strength": 1,
          },
        });
        map.addLayer({
          id: "plume-line",
          type: "line",
          source: "plume",
          slot: "middle",
          paint: {
            "line-color": "#DC2626",
            "line-width": 2.5,
            "line-emissive-strength": 1,
          },
        });
      }
      if (wind) {
        map.addSource("wind", {
          type: "geojson",
          data: windArrow({ ...site, control }, wind.u, wind.v),
        });
        map.addLayer({
          id: "wind-line",
          type: "line",
          source: "wind",
          slot: "top",
          filter: ["==", ["geometry-type"], "LineString"],
          paint: {
            "line-color": "#FFFFFF",
            "line-width": 4,
            "line-emissive-strength": 1,
          },
        });
        map.addLayer({
          id: "wind-head",
          type: "fill",
          source: "wind",
          slot: "top",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#FFFFFF", "fill-emissive-strength": 1 },
        });
      }
      if (control) {
        const el = document.createElement("div");
        el.className = "vayu-map-badge";
        el.style.setProperty("--badge", "#4A6355");
        el.textContent = controlLabel;
        markers.push(
          new mapboxgl.Marker({ element: el, anchor: "bottom" })
            .setLngLat([control.lon, control.lat])
            .addTo(map),
        );
      }
    });
    return () => {
      markers.forEach((m) => m.remove());
      map.remove();
    };
  }, [token, site, evidence, wind, control, controlLabel]);

  // size-full, not just absolute inset-0: mapbox-gl.css sets .mapboxgl-map { position: relative }, and as
  // unlayered CSS it beats Tailwind's layered utilities, which left the container 0 px tall (a 300 px canvas).
  return (
    <div
      ref={ref}
      className="absolute inset-0 size-full"
      role="region"
      aria-label={label}
    />
  );
}
