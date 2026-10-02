import { type Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Landing } from "@/components/landing/Landing";
import { getLandingData } from "@/lib/landing-data";

// Supabase numbers are cached for 10 minutes (ISR).
export const revalidate = 600;

export default async function HomePage({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  // The [locale] layout has already rejected unknown locales.
  setRequestLocale(locale as Locale);
  const data = await getLandingData();
  return (
    <Landing
      data={data}
      env={{
        mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN || undefined,
        mapillaryToken: process.env.NEXT_PUBLIC_MAPILLARY_TOKEN || undefined,
        videoUrl: process.env.NEXT_PUBLIC_VIDEO_URL || undefined,
      }}
    />
  );
}
