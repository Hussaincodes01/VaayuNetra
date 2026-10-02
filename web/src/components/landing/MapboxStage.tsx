"use client";

// The single Mapbox GL map fixed behind the page. Loaded with next/dynamic only when
// NEXT_PUBLIC_MAPBOX_TOKEN is set. Driven by map-bus: the hero scrubs the globe to India and
// Delhi; the field test flies landfill to landfill and shows each flagged pass's evidence.

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import type { Flag, Site } from "@/lib/landing-types";
import { getMapScene, subscribeMapScene, type MapScene } from "./map-bus";
import { TIER_COLOUR } from "./format";

export type TourStop = { site: Site; flag: Flag | null };
type GeoData = mapboxgl.GeoJSONSourceSpecification["data"];

type Props = {
  token: string;
  stops: TourStop[];
  reducedMotion: boolean;
  narrow: boolean;
  controlLabel: string;
};

const HERO_KEYS = [
  { t: 0, lon: 52, lat: 16, zoom: 1.3, pitch: 0, bearing: 0 },
  { t: 0.5, lon: 79, lat: 22.5, zoom: 3.7, pitch: 15, bearing: 0 },
  { t: 1, lon: 77.22, lat: 28.62, zoom: 9.4, pitch: 48, bearing: -12 },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function heroCamera(progress: number) {
  const p = Math.min(1, Math.max(0, progress));
  const [a, b] =
    p <= 0.5 ? [HERO_KEYS[0], HERO_KEYS[1]] : [HERO_KEYS[1], HERO_KEYS[2]];
  const t = ease((p - a.t) / (b.t - a.t));
  return {
    center: [lerp(a.lon, b.lon, t), lerp(a.lat, b.lat, t)] as [number, number],
    zoom: lerp(a.zoom, b.zoom, t),
    pitch: lerp(a.pitch, b.pitch, t),
    bearing: lerp(a.bearing, b.bearing, t),
  };
}

/** Arrow from the site along the wind (towards where it blows), as two GeoJSON features. */
export function windArrow(site: Site, u: number, v: number): GeoData {
  const speed = Math.hypot(u, v) || 1;
  const metres = 650;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((site.lat * Math.PI) / 180);
  const dx = (u / speed) * metres;
  const dy = (v / speed) * metres;
  const tip: [number, number] = [
    site.lon + dx / mPerDegLon,
    site.lat + dy / mPerDegLat,
  ];
  const head = (angle: number): [number, number] => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const hx = (-dx * c + dy * s) * 0.22;
    const hy = (-dx * s - dy * c) * 0.22;
    return [tip[0] + hx / mPerDegLon, tip[1] + hy / mPerDegLat];
  };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [[site.lon, site.lat], tip],
        },
      },
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [[tip, head(0.45), head(-0.45), tip]],
        },
      },
    ],
  };
}

function badgeEl(text: string, colour: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "vayu-map-badge";
  el.style.setProperty("--badge", colour);
  el.textContent = text;
  el.setAttribute("aria-hidden", "true");
  return el;
}

export default function MapboxStage({
  token,
  stops,
  reducedMotion,
  narrow,
  controlLabel,
}: Props) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    mapboxgl.accessToken = token;
    const start = heroCamera(0);
    const map = new mapboxgl.Map({
      container: container.current,
      style: "mapbox://styles/mapbox/standard-satellite",
      config: {
        basemap: {
          lightPreset: "night",
          showPointOfInterestLabels: false,
          showTransitLabels: false,
        },
      },
      projection: "globe",
      ...start,
      interactive: false,
      fadeDuration: 0,
      attributionControl: true,
      logoPosition: "bottom-right",
    });
    // Tile and network hiccups are not page errors; with a listener attached Mapbox stays quiet.
    map.on("error", () => undefined);

    const markers: mapboxgl.Marker[][] = [];
    let ready = false;
    let spin = 0;
    let raf = 0;
    let shown = -1;

    const showStop = (index: number) => {
      if (!ready || index === shown) return;
      shown = index;
      stops.forEach((_, i) => {
        const on = i === index;
        const set = (layer: string, prop: string, value: number) => {
          if (map.getLayer(layer))
            map.setPaintProperty(layer, prop as never, value as never);
        };
        set(`chip-${i}`, "raster-opacity", on ? 0.95 : 0);
        set(`plume-fill-${i}`, "fill-opacity", on ? 0.55 : 0);
        set(`plume-line-${i}`, "line-opacity", on ? 1 : 0);
        set(`wind-line-${i}`, "line-opacity", on ? 1 : 0);
        set(`wind-head-${i}`, "fill-opacity", on ? 1 : 0);
        markers[i]?.forEach(
          (m) => (m.getElement().style.display = on ? "" : "none"),
        );
      });
      const stop = stops[index];
      if (!stop) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      map.setConfigProperty("basemap", "lightPreset", "day");
      const camera = {
        center: [stop.site.lon, stop.site.lat] as [number, number],
        zoom: 14.4,
        pitch: 60,
        bearing: -25 + index * 32,
        padding: narrow
          ? { top: 0, bottom: h * 0.48, left: 0, right: 0 }
          : { top: 0, bottom: 0, left: w * 0.42, right: 0 },
      };
      if (reducedMotion) map.jumpTo(camera);
      else
        map.flyTo({ ...camera, duration: 3200, curve: 1.6, essential: true });
    };

    const showHero = (progress: number) => {
      if (shown !== -1) {
        shown = -1;
        stops.forEach((_, i) => {
          for (const layer of [
            `chip-${i}`,
            `plume-fill-${i}`,
            `plume-line-${i}`,
            `wind-line-${i}`,
          ]) {
            if (map.getLayer(layer)) {
              const prop = layer.startsWith("chip")
                ? "raster-opacity"
                : layer.includes("fill")
                  ? "fill-opacity"
                  : "line-opacity";
              map.setPaintProperty(layer, prop as never, 0 as never);
            }
          }
          if (map.getLayer(`wind-head-${i}`))
            map.setPaintProperty(`wind-head-${i}`, "fill-opacity", 0);
          markers[i]?.forEach((m) => (m.getElement().style.display = "none"));
        });
        map.setConfigProperty("basemap", "lightPreset", "night");
      }
      const cam = heroCamera(progress);
      if (progress < 0.01 && !reducedMotion) cam.center[0] += spin;
      map.jumpTo(cam);
    };

    const apply = (scene: MapScene) => {
      if (scene.kind === "hero") showHero(scene.progress);
      else if (scene.kind === "site") showStop(scene.index);
    };

    const loop = () => {
      const scene = getMapScene();
      if (scene.kind === "hero" && scene.progress < 0.01) {
        spin = (spin + 0.04) % 360;
        showHero(scene.progress);
      }
      raf = requestAnimationFrame(loop);
    };

    map.on("style.load", () => {
      if (!map.getSource("vayu-dem")) {
        map.addSource("vayu-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.setTerrain({ source: "vayu-dem", exaggeration: 1.6 });

      map.addSource("vayu-sites", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: stops.map(({ site }) => ({
            type: "Feature",
            properties: { slug: site.slug },
            geometry: { type: "Point", coordinates: [site.lon, site.lat] },
          })),
        },
      });
      map.addLayer({
        id: "vayu-sites-glow",
        type: "circle",
        source: "vayu-sites",
        slot: "top",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            4,
            6,
            9,
            12,
            0,
          ],
          "circle-color": "#F59E0B",
          "circle-blur": 0.8,
          "circle-opacity": 0.9,
          "circle-emissive-strength": 1,
        },
      });

      stops.forEach(({ site, flag }, i) => {
        markers[i] = [];
        const ev = flag?.evidence;
        if (ev) {
          map.addSource(`chip-${i}`, {
            type: "image",
            url: ev.rgb,
            coordinates: ev.chipBounds as [
              [number, number],
              [number, number],
              [number, number],
              [number, number],
            ],
          });
          map.addLayer({
            id: `chip-${i}`,
            type: "raster",
            source: `chip-${i}`,
            slot: "middle",
            paint: {
              "raster-opacity": 0,
              "raster-opacity-transition": { duration: 900 },
              "raster-fade-duration": 0,
            },
          });
          if (ev.plume) {
            map.addSource(`plume-${i}`, {
              type: "geojson",
              data: ev.plume as unknown as GeoData,
            });
            map.addLayer({
              id: `plume-fill-${i}`,
              type: "fill",
              source: `plume-${i}`,
              slot: "middle",
              paint: {
                "fill-color": "#F59E0B",
                "fill-opacity": 0,
                "fill-opacity-transition": { duration: 900 },
                "fill-emissive-strength": 1,
              },
            });
            map.addLayer({
              id: `plume-line-${i}`,
              type: "line",
              source: `plume-${i}`,
              slot: "middle",
              paint: {
                "line-color": "#DC2626",
                "line-width": 2.5,
                "line-opacity": 0,
                "line-opacity-transition": { duration: 900 },
                "line-emissive-strength": 1,
              },
            });
          }
        }
        if (flag && flag.windU !== null && flag.windV !== null) {
          map.addSource(`wind-${i}`, {
            type: "geojson",
            data: windArrow(site, flag.windU, flag.windV),
          });
          map.addLayer({
            id: `wind-line-${i}`,
            type: "line",
            source: `wind-${i}`,
            slot: "top",
            filter: ["==", ["geometry-type"], "LineString"],
            paint: {
              "line-color": "#2DD4BF",
              "line-width": 4,
              "line-opacity": 0,
              "line-opacity-transition": { duration: 900 },
              "line-emissive-strength": 1,
            },
          });
          map.addLayer({
            id: `wind-head-${i}`,
            type: "fill",
            source: `wind-${i}`,
            slot: "top",
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: {
              "fill-color": "#2DD4BF",
              "fill-opacity": 0,
              "fill-opacity-transition": { duration: 900 },
              "fill-emissive-strength": 1,
            },
          });
        }
        if (flag) {
          markers[i].push(
            new mapboxgl.Marker({
              element: badgeEl(flag.tier, TIER_COLOUR[flag.tier]),
              anchor: "bottom",
              offset: [0, -14],
            })
              .setLngLat([site.lon, site.lat])
              .addTo(map),
          );
        }
        if (site.control) {
          markers[i].push(
            new mapboxgl.Marker({
              element: badgeEl(controlLabel, "#8A93A6"),
              anchor: "bottom",
            })
              .setLngLat([site.control.lon, site.control.lat])
              .addTo(map),
          );
        }
        markers[i].forEach((m) => (m.getElement().style.display = "none"));
      });

      ready = true;
      apply(getMapScene());
    });

    const unsubscribe = subscribeMapScene(apply);
    if (!reducedMotion) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      markers.flat().forEach((m) => m.remove());
      map.remove();
    };
  }, [token, stops, reducedMotion, narrow, controlLabel]);

  return <div ref={container} className="vayu-map absolute inset-0" />;
}
