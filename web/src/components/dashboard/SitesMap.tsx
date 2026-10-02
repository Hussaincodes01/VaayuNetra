"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { SiteStatus } from "@/lib/landing-types";
import { usePlaces } from "@/components/landing/format";
import { STATUS_COLOUR } from "./status";

export type MapSite = {
  slug: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  status: SiteStatus;
};

const MapboxSitesMap = dynamic(() => import("./MapboxSitesMap"), {
  ssr: false,
});

/** All sites coloured by status. Mapbox with a token; otherwise a schematic lat/lon plot (no borders drawn). */
export function SitesMap({
  sites,
  hrefBase,
  height = 420,
}: {
  sites: MapSite[];
  hrefBase: string;
  height?: number;
}) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const t = useTranslations("Dash.map");
  const tStatus = useTranslations("Dash.status");
  const places = usePlaces();
  const legend = (Object.keys(STATUS_COLOUR) as SiteStatus[]).map((s) => (
    <li key={s} className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="size-2.5 rounded-full"
        style={{ background: STATUS_COLOUR[s] }}
      />
      {tStatus(s)}
    </li>
  ));

  return (
    <figure className="overflow-hidden rounded-xl border border-white/10 bg-card">
      <div style={{ height }} className="relative">
        {token ? (
          <MapboxSitesMap
            token={token}
            sites={sites}
            hrefBase={hrefBase}
            label={t("label")}
          />
        ) : (
          <SchematicMap
            sites={sites}
            hrefBase={hrefBase}
            label={t("label")}
            name={(s) => places.site(s.slug, s.name)}
          />
        )}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3 text-xs text-muted-foreground">
        <ul className="flex flex-wrap gap-4">{legend}</ul>
        {!token && <span>{t("schematic")}</span>}
      </figcaption>
    </figure>
  );
}

// Equirectangular plot over the sites' extent. Deliberately no country or state borders.
function SchematicMap({
  sites,
  hrefBase,
  label,
  name,
}: {
  sites: MapSite[];
  hrefBase: string;
  label: string;
  name: (s: MapSite) => string;
}) {
  const W = 1000;
  const H = 620;
  const lons = sites.map((s) => s.lon);
  const lats = sites.map((s) => s.lat);
  const pad = 2.2;
  const [x0, x1] = [Math.min(...lons) - pad, Math.max(...lons) + pad];
  const [y0, y1] = [Math.min(...lats) - pad, Math.max(...lats) + pad];
  const kx = W / (x1 - x0);
  const ky = H / (y1 - y0);
  const k = Math.min(kx, ky);
  const ox = (W - (x1 - x0) * k) / 2;
  const oy = (H - (y1 - y0) * k) / 2;
  const px = (lon: number) => ox + (lon - x0) * k;
  const py = (lat: number) => oy + (y1 - lat) * k;
  const grid = [];
  for (let lon = Math.ceil(x0); lon <= x1; lon += 2) grid.push({ lon });
  const gridLat = [];
  for (let lat = Math.ceil(y0); lat <= y1; lat += 2) gridLat.push({ lat });
  // Sites in the same city sit close together: fan labels out vertically.
  const byCity = new Map<string, MapSite[]>();
  sites.forEach((s) => byCity.set(s.city, [...(byCity.get(s.city) ?? []), s]));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="size-full"
      role="group"
      aria-label={label}
    >
      <rect width={W} height={H} fill="#070b16" />
      {grid.map((g) => (
        <g key={`x${g.lon}`}>
          <line
            x1={px(g.lon)}
            x2={px(g.lon)}
            y1={0}
            y2={H}
            stroke="#ffffff10"
          />
          <text
            x={px(g.lon) + 4}
            y={H - 8}
            fill="#8A93A6"
            fontSize={13}
            className="font-mono"
          >
            {g.lon}°E
          </text>
        </g>
      ))}
      {gridLat.map((g) => (
        <g key={`y${g.lat}`}>
          <line
            x1={0}
            x2={W}
            y1={py(g.lat)}
            y2={py(g.lat)}
            stroke="#ffffff10"
          />
          <text
            x={6}
            y={py(g.lat) - 4}
            fill="#8A93A6"
            fontSize={13}
            className="font-mono"
          >
            {g.lat}°N
          </text>
        </g>
      ))}
      {[...byCity.values()].map((group) =>
        group.map((s, i) => {
          const x = px(s.lon);
          const y = py(s.lat);
          const ly = y - 34 + i * 30 - ((group.length - 1) * 30) / 2;
          return (
            <Link
              key={s.slug}
              href={`${hrefBase}/${s.slug}`}
              aria-label={`${name(s)}, ${s.city}`}
              className="group outline-none"
            >
              <circle
                cx={x}
                cy={y}
                r={22}
                fill={STATUS_COLOUR[s.status]}
                opacity={0.18}
              />
              <circle
                cx={x}
                cy={y}
                r={8}
                fill={STATUS_COLOUR[s.status]}
                stroke="#05070D"
                strokeWidth={2}
              />
              {group.length > 1 && (
                <line
                  x1={x}
                  y1={y}
                  x2={x + 40}
                  y2={ly + 34 - 6}
                  stroke="#ffffff30"
                />
              )}
              <text
                x={x + (group.length > 1 ? 46 : 16)}
                y={group.length > 1 ? ly + 34 : y + 6}
                fill="#E8ECF4"
                fontSize={20}
                className="font-heading group-hover:underline group-focus-visible:underline"
              >
                {name(s)}
              </text>
            </Link>
          );
        }),
      )}
    </svg>
  );
}
