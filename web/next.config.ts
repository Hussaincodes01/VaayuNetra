import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const dev = process.env.NODE_ENV !== "production";
// Vercel sets VERCEL_ENV at build time; preview deployments load the Vercel toolbar from vercel.live.
const preview = process.env.VERCEL_ENV === "preview";

const origin = (url: string | undefined): string | null => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

// Supabase: REST, Auth, Storage images and Realtime (WebSocket).
const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseWs = supabase?.replace(/^http/, "ws") ?? null;

// The film: only the host NEXT_PUBLIC_VIDEO_URL points at (YouTube, Vimeo or a file host such as Vercel Blob).
function videoSources(url: string | undefined): {
  frame: string[];
  media: string[];
} {
  if (!url) return { frame: [], media: [] };
  if (/youtube\.com|youtu\.be/.test(url))
    return { frame: ["https://www.youtube-nocookie.com"], media: [] };
  if (/vimeo\.com/.test(url))
    return { frame: ["https://player.vimeo.com"], media: [] };
  const host = origin(url);
  return { frame: [], media: host ? [host] : [] };
}
const video = videoSources(process.env.NEXT_PUBLIC_VIDEO_URL);

const mapbox = [
  "https://api.mapbox.com",
  "https://events.mapbox.com",
  "https://*.tiles.mapbox.com",
];
const mapillary = [
  "https://graph.mapillary.com",
  "https://tiles.mapillary.com",
  "https://*.fbcdn.net",
];
const sentry = ["https://*.sentry.io"];
const vercelLive = preview ? ["https://vercel.live"] : [];

const join = (...parts: (string | null | false | undefined)[][]) =>
  parts
    .flat()
    .filter((p): p is string => Boolean(p))
    .join(" ");

/**
 * Content Security Policy. Scripts: 'unsafe-inline' is needed for the inline bootstrap scripts Next.js
 * writes into every page; the nonce alternative would force every page to render per request (no static
 * landing page). External script hosts stay closed: nothing outside this origin can run code here.
 * 'wasm-unsafe-eval' lets Mapbox GL compile its WebAssembly decoders; 'unsafe-eval' is development only.
 */
const csp = [
  ["default-src", "'self'"],
  [
    "script-src",
    join(
      ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
      dev ? ["'unsafe-eval'", "https://va.vercel-scripts.com"] : [],
      vercelLive,
    ),
  ],
  ["style-src", join(["'self'", "'unsafe-inline'"], vercelLive)],
  [
    "img-src",
    join(
      ["'self'", "data:", "blob:", supabase],
      ["https://api.mapbox.com", "https://*.tiles.mapbox.com"],
      ["https://*.fbcdn.net", "https://*.mapillary.com"],
      preview ? ["https://vercel.live", "https://vercel.com"] : [],
    ),
  ],
  [
    "font-src",
    join(
      ["'self'", "data:"],
      preview ? ["https://vercel.live", "https://assets.vercel.com"] : [],
    ),
  ],
  [
    "connect-src",
    join(
      ["'self'", supabase, supabaseWs],
      mapbox,
      mapillary,
      sentry,
      dev ? ["ws:"] : [],
      preview ? ["https://vercel.live", "wss://ws-us3.pusher.com"] : [],
    ),
  ],
  ["media-src", join(["'self'", "blob:", supabase], video.media)],
  ["frame-src", join(video.frame, vercelLive) || "'none'"],
  ["worker-src", "'self' blob:"],
  ["child-src", "'self' blob:"],
  ["manifest-src", "'self'"],
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'"],
  ["frame-ancestors", "'none'"],
  // Only when the backend is HTTPS too: locally Supabase runs on http://127.0.0.1.
  ...(!dev && supabase?.startsWith("https:")
    ? [["upgrade-insecure-requests", ""]]
    : []),
]
  .map(([k, v]) => (v ? `${k} ${v}` : k))
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // On Vercel, api/ground.py runs as a Python function. In development it runs beside `next dev`
  // (python scripts/ground-api-dev.py), so the dashboard's ground-network pages work locally too.
  async rewrites() {
    return dev
      ? [{ source: "/api/ground", destination: "http://127.0.0.1:8787/api/ground" }]
      : [];
  },
};

export default withNextIntl(nextConfig);
