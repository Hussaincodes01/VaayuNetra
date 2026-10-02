// Locale-aware formatting usable from server and client components (Latin digits in both locales).

export type Formatter = ReturnType<typeof makeFormat>;

export function makeFormat(locale: string) {
  const tag = locale === "hi" ? "hi-IN" : "en-IN";
  const num = (v: number, digits = 0) =>
    new Intl.NumberFormat(tag, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v);
  const pct = (v: number, digits = 0) =>
    new Intl.NumberFormat(tag, {
      style: "percent",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v);
  const date = (iso: string, style: "long" | "short" = "long") =>
    new Intl.DateTimeFormat(tag, {
      day: "numeric",
      month: style === "long" ? "long" : "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
  const dateTime = (iso: string) =>
    new Intl.DateTimeFormat(tag, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(new Date(iso));
  const tph = (kgph: number) => num(kgph / 1000, 1);
  // Dollar amounts use Western digit grouping (419,000), rupees and tonnes the Indian one.
  const usd = (v: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);
  return { locale, num, pct, date, dateTime, tph, usd };
}

type PlaceT = { has: (key: never) => boolean; (key: never): string };

/** Localised site / region name (messages "Places"), falling back to the database value. */
export function placeName(
  t: PlaceT,
  kind: "sites" | "regions",
  key: string,
  fallback: string,
): string {
  const k = `${kind}.${key}` as never;
  return t.has(k) ? t(k) : fallback;
}

/** Canonical URL and language alternates for a public page at `path` ("/map", "/map/deonar"). */
export function pageAlternates(locale: string, path: string) {
  return {
    canonical: locale === "hi" ? `/hi${path}` : path,
    languages: { en: path, hi: `/hi${path}`, "x-default": path },
  };
}
