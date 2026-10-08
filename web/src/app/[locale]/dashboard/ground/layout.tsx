import { getTranslations } from "next-intl/server";
import { GroundTabs } from "@/components/ground/GroundTabs";

export async function generateMetadata() {
  const t = await getTranslations("Ground");
  return { title: t("title") };
}

/** The ground network: the full flow from a satellite flag to a confirmed fix, and its simulations. */
export default async function GroundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("Ground");
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="flex flex-wrap items-center gap-3 font-heading text-3xl font-semibold text-canopy">
          {t("title")}
          <span className="rounded-full bg-sky px-2.5 py-0.5 font-sans text-xs font-semibold text-[#1F4A5C]">
            {t("badge")}
          </span>
        </h1>
        <p className="max-w-3xl text-sm text-foreground/80">{t("intro")}</p>
      </header>
      <GroundTabs />
      {children}
    </div>
  );
}
