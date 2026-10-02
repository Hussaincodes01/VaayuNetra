import { type Locale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { LastUpdated } from "@/components/LastUpdated";
import { getViewer } from "@/lib/dashboard-data";
import { getLastUpdated } from "@/lib/last-updated";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "Dash",
  });
  return {
    title: { default: t("title"), template: `%s · ${t("title")}` },
    robots: { index: false },
  };
}

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  if (!supabaseConfigured) {
    const t = await getTranslations("Dash");
    return (
      <main
        id="main"
        className="flex min-h-dvh items-center justify-center bg-background p-6 text-center"
      >
        <p className="max-w-md text-foreground/80">{t("notConfigured")}</p>
      </main>
    );
  }
  const viewer = await getViewer();
  if (!viewer)
    redirect({
      href: { pathname: "/login", query: { next: "/dashboard" } },
      locale: locale as Locale,
    });
  return (
    <div className="min-h-dvh bg-background">
      <DashboardNav viewer={viewer!} />
      <main id="main" className="mx-auto max-w-7xl px-4 pt-20 pb-16 md:px-8">
        {/* From Supabase, so it renders while the worker is offline. */}
        <LastUpdated at={await getLastUpdated()} className="mb-4 text-right" />
        {children}
      </main>
    </div>
  );
}
