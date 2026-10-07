import { type Locale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ScreeningNote } from "@/components/landing/ui";
import { SensorSimulator } from "@/components/simulator/SensorSimulator";
import { Link } from "@/i18n/navigation";
import { makeFormat, pageAlternates } from "@/lib/format";
import sensorModel from "@/lib/sensor-model.json";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "Simulator",
  });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: pageAlternates(locale, "/simulator"),
  };
}

/** A public, interactive sensor-network simulator: the physics and the model run in the browser. */
export default async function SimulatorPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("Simulator");
  const f = makeFormat(locale);
  const weights = sensorModel.layers.reduce(
    (s, l) => s + l.W.length * l.b.length + l.b.length,
    0,
  );

  return (
    <main id="main" className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 md:px-8">
          <Link href="/" className="font-heading text-lg font-semibold">
            Vayu<span className="text-signal">Netra</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/system" className="hover:text-foreground">
              {t("nav.system")}
            </Link>
            <Link href="/scorecard" className="hover:text-foreground">
              {t("nav.scorecard")}
            </Link>
            <Link
              href="/map"
              className="hidden hover:text-foreground sm:inline"
            >
              {t("nav.map")}
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 md:px-8">
        <div className="space-y-3">
          <h1 className="font-heading text-3xl font-semibold text-canopy md:text-4xl">
            {t("title")}
          </h1>
          <p className="max-w-3xl text-foreground/80">{t("intro")}</p>
          <p className="max-w-3xl text-sm text-foreground/80">
            {t("how", { weights })}
          </p>
        </div>

        <SensorSimulator />

        <div className="max-w-4xl space-y-3 text-sm text-foreground/85">
          <p>
            {t("note", {
              auc: f.num(Number(sensorModel.metrics.test_roc_auc), 3),
              weights,
            })}
          </p>
          <p className="text-muted-foreground">{t("method")}</p>
          <p className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/system" className="text-leaf hover:underline">
              {t("links.system")}
            </Link>
          </p>
        </div>
        <ScreeningNote />
      </div>
    </main>
  );
}
