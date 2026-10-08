"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { S, toLngLat } from "@/lib/ground/sim";
import type { SiteBundle } from "@/lib/ground/types";
import { PACKET_COLOUR, statusColour, type Snapshot } from "./snapshot";

// The node assembly is modelled in millimetres; 0.06 draws it 60 times life size (about 90 m tall)
// so it reads at site scale. The page says so under the map.
const MODEL_SCALE = 0.06;

// GeoJSON as mapbox-gl types it (the global GeoJSON namespace is not visible to this package).
type FC = Exclude<Parameters<mapboxgl.GeoJSONSource["setData"]>[0], string>;
const empty = (): FC => ({ type: "FeatureCollection", features: [] });

/**
 * The site in 3D on Mapbox: terrain, the fence line, the node model at every planned node (status
 * ring and label under it), methane above background as extruded cells, and each packet on air
 * as a line from sender to every node that heard it. Clicking a node selects it; clicking the
 * ground moves the leak.
 */
export default function Site3D({
  token,
  bundle,
  snap,
  selected,
  onSelect,
  onPick,
  label,
  leakLabel,
}: {
  token: string;
  bundle: SiteBundle;
  snap: Snapshot | null;
  selected: number;
  onSelect: (i: number) => void;
  onPick: (x: number, y: number) => void;
  label: string;
  leakLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  // Set once the style has loaded and every source and layer exists; the data effect waits for it.
  const [ready, setReady] = useState(false);
  const handlers = useRef({ onSelect, onPick });
  useEffect(() => {
    handlers.current = { onSelect, onPick };
  }, [onSelect, onPick]);
  const center = bundle.plan.center;
  const nodes = bundle.lab.nodes;

  useEffect(() => {
    if (!ref.current) return;
    mapboxgl.accessToken = token;
    const [lng, lat] = toLngLat(center, 0, 0);
    const map = new mapboxgl.Map({
      container: ref.current,
      style: "mapbox://styles/mapbox/standard",
      config: {
        basemap: { lightPreset: "day", showPointOfInterestLabels: false },
      },
      worldview: "IN",
      center: [lng, lat],
      zoom: 14.9,
      pitch: 62,
      bearing: -25,
      antialias: true,
      cooperativeGestures: true,
    });
    mapRef.current = map;
    // Tile and style errors are expected offline; in development, say what failed.
    map.on("error", (e) => {
      if (process.env.NODE_ENV !== "production")
        console.warn("mapbox:", e.error?.message);
    });
    map.addControl(
      new mapboxgl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );
    map.on("style.load", () => {
      map.addSource("dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
      });
      map.setTerrain({ source: "dem", exaggeration: 1.2 });
      // Absolute: Mapbox fetches models outside the page, where a bare path does not resolve.
      map.addModel(
        "vn-node",
        `${window.location.origin}/ground/3d/node_map.glb`,
      );
      for (const id of [
        "outline",
        "links",
        "plume",
        "packets",
        "nodes",
        "points",
      ])
        map.addSource(id, { type: "geojson", data: empty() });
      map.addLayer({
        id: "plume",
        type: "fill-extrusion",
        source: "plume",
        paint: {
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["get", "ex"],
            0.5,
            "#FDE68A",
            5,
            "#F59E0B",
            50,
            "#DC2626",
          ],
          "fill-extrusion-height": ["get", "h"],
          "fill-extrusion-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "outline",
        type: "line",
        source: "outline",
        paint: {
          "line-color": "#0E3B2A",
          "line-width": 2.5,
          "line-dasharray": [2, 1.5],
        },
      });
      map.addLayer({
        id: "links",
        type: "line",
        source: "links",
        paint: {
          "line-color": [
            "match",
            ["get", "q"],
            "good",
            "#1E7B45",
            "fair",
            "#B45309",
            "#B91C1C",
          ],
          "line-width": 1,
          "line-opacity": 0.35,
        },
      });
      map.addLayer({
        id: "packets",
        type: "line",
        source: "packets",
        paint: {
          "line-color": ["get", "c"],
          "line-width": ["get", "w"],
          "line-opacity": ["get", "o"],
        },
      });
      map.addLayer({
        id: "node-rings",
        type: "circle",
        source: "nodes",
        paint: {
          "circle-radius": ["case", ["get", "sel"], 16, 11],
          "circle-color": ["get", "c"],
          "circle-opacity": 0.85,
          "circle-stroke-color": ["case", ["get", "sel"], "#0E3B2A", "#FFFFFF"],
          "circle-stroke-width": ["case", ["get", "sel"], 3, 2],
          "circle-pitch-alignment": "map",
        },
      });
      map.addLayer({
        id: "node-models",
        type: "model",
        source: "nodes",
        filter: ["!=", ["get", "role"], "gateway"],
        layout: { "model-id": "vn-node" },
        paint: {
          "model-scale": [MODEL_SCALE, MODEL_SCALE, MODEL_SCALE],
          "model-rotation": [0, 0, 0],
          "model-type": "common-3d",
          "model-color": ["get", "c"],
          "model-color-mix-intensity": ["case", ["get", "warn"], 0.45, 0],
        },
      });
      map.addLayer({
        id: "points",
        type: "circle",
        source: "points",
        paint: {
          "circle-radius": ["match", ["get", "kind"], "leak", 9, 6],
          "circle-color": [
            "match",
            ["get", "kind"],
            "leak",
            "#DC2626",
            "hotspot",
            "#DC2626",
            "school",
            "#4A86CF",
            "#4A86CF",
          ],
          "circle-opacity": ["match", ["get", "kind"], "leak", 0.25, 0.9],
          "circle-stroke-color": [
            "match",
            ["get", "kind"],
            "leak",
            "#B91C1C",
            "#FFFFFF",
          ],
          "circle-stroke-width": 2,
          "circle-pitch-alignment": "map",
        },
      });
      map.addLayer({
        id: "labels",
        type: "symbol",
        source: "nodes",
        layout: {
          "text-field": ["get", "id"],
          "text-size": 12,
          "text-offset": [0, 1.6],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        },
        paint: {
          "text-color": "#0E3B2A",
          "text-halo-color": "#FFFFFF",
          "text-halo-width": 1.5,
        },
      });
      map.addLayer({
        id: "point-labels",
        type: "symbol",
        source: "points",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-offset": [0, 1.4],
          "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"],
        },
        paint: {
          "text-color": "#15301F",
          "text-halo-color": "#FFFFFF",
          "text-halo-width": 1.5,
        },
      });
      const outline = bundle.site.outline;
      (map.getSource("outline") as mapboxgl.GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: outline.coordinates[0] },
      });
      const pos = new Map(nodes.map((n) => [n.id, [n.lon, n.lat]]));
      (map.getSource("links") as mapboxgl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: bundle.plan.links
          .filter((l) => pos.has(l.a) && pos.has(l.b))
          .map((l) => ({
            type: "Feature",
            properties: { q: l.quality },
            geometry: {
              type: "LineString",
              coordinates: [pos.get(l.a)!, pos.get(l.b)!],
            },
          })),
      });
      setReady(true);
    });
    map.on("click", (e) => {
      const hit = map.queryRenderedFeatures(e.point, {
        layers: ["node-rings"],
      })[0];
      const props = (
        hit as { properties?: Record<string, unknown> } | undefined
      )?.properties;
      if (props) return handlers.current.onSelect(Number(props.i));
      const k = 111_320 * Math.cos((center[0] * Math.PI) / 180);
      const [clon, clat] = toLngLat(center, 0, 0);
      handlers.current.onPick(
        (e.lngLat.lng - clon) * k,
        (e.lngLat.lat - clat) * 110_574,
      );
    });
    map.on(
      "mouseenter",
      "node-rings",
      () => (map.getCanvas().style.cursor = "pointer"),
    );
    map.on(
      "mouseleave",
      "node-rings",
      () => (map.getCanvas().style.cursor = ""),
    );
    return () => {
      setReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [token, bundle, center, nodes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !snap) return;
    const set = (id: string, data: FC) =>
      (map.getSource(id) as mapboxgl.GeoJSONSource | undefined)?.setData(data);
    set("nodes", {
      type: "FeatureCollection",
      features: nodes.map((n, i) => {
        const s = snap.states[i];
        return {
          type: "Feature",
          properties: {
            i,
            id: n.id,
            role: n.role,
            c: statusColour(s, n.role),
            sel: i === selected,
            warn: s[S.ev] >= 1 || !s[S.on],
          },
          geometry: { type: "Point", coordinates: [n.lon, n.lat] },
        };
      }),
    });
    const half = snap.plumeCell / 2;
    set("plume", {
      type: "FeatureCollection",
      features: snap.plume.map((c) => {
        const ring = [
          [c.x - half, c.y - half],
          [c.x + half, c.y - half],
          [c.x + half, c.y + half],
          [c.x - half, c.y + half],
          [c.x - half, c.y - half],
        ].map(([x, y]) => toLngLat(center, x, y));
        return {
          type: "Feature",
          properties: { ex: c.ex, h: 6 + 16 * Math.log2(1 + c.ex) },
          geometry: { type: "Polygon", coordinates: [ring] },
        };
      }),
    });
    const now = performance.now();
    set("packets", {
      type: "FeatureCollection",
      features: snap.packets.flatMap((p) => {
        const age = Math.min(1, (now - p.born) / 900);
        const from = nodes[p.src];
        if (!from) return [];
        return p.heard
          .filter((j) => nodes[j])
          .map((j) => ({
            type: "Feature" as const,
            properties: {
              c: PACKET_COLOUR[p.type] ?? "#64748B",
              w: p.relay ? 1.5 : 3,
              o: (1 - age) * (p.relay ? 0.5 : 0.9),
            },
            geometry: {
              type: "LineString" as const,
              coordinates: [
                [from.lon, from.lat],
                [nodes[j].lon, nodes[j].lat],
              ],
            },
          }));
      }),
    });
    const [llon, llat] = toLngLat(center, snap.leak.x, snap.leak.y);
    set("points", {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { kind: "leak", label: leakLabel },
          geometry: { type: "Point", coordinates: [llon, llat] },
        },
        ...bundle.lab.hotspots.map((h) => ({
          type: "Feature" as const,
          properties: { kind: "hotspot", label: h.label },
          geometry: { type: "Point" as const, coordinates: [h.lon, h.lat] },
        })),
        ...bundle.site.sensitive_sites.slice(0, 6).map((p) => ({
          type: "Feature" as const,
          properties: { kind: p.kind, label: p.name },
          geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
        })),
      ],
    });
  }, [ready, snap, selected, nodes, center, bundle, leakLabel]);

  return (
    <div
      ref={ref}
      className="absolute inset-0 size-full"
      role="region"
      aria-label={label}
    />
  );
}
