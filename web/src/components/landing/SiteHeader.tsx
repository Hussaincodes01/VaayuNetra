"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

const SECTIONS = [
  "signal",
  "how",
  "proof",
  "field",
  "action",
  "honest",
  "film",
  "initiative",
] as const;

export function SiteHeader({ hasFilm }: { hasFilm: boolean }) {
  const t = useTranslations("Nav");
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === "hi" ? "en" : "hi";
  const sections = SECTIONS.filter((s) => s !== "film" || hasFilm);

  return (
    <>
      <a
        href="#main"
        className="fixed top-2 left-2 z-50 -translate-y-20 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:translate-y-0"
      >
        {t("skip")}
      </a>
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/5 bg-background/70 backdrop-blur-md">
        <nav
          className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 md:px-8"
          aria-label="VayuNetra"
        >
          <a
            href="#top"
            className="font-heading text-lg font-semibold tracking-tight"
            aria-label={t("home")}
          >
            Vayu<span className="text-signal">Netra</span>
          </a>
          <ul className="hidden flex-1 items-center gap-5 text-sm text-muted-foreground lg:flex">
            {sections.map((s) => (
              <li key={s}>
                <a
                  href={`#${s}`}
                  className="transition-colors hover:text-foreground"
                >
                  {t(s)}
                </a>
              </li>
            ))}
          </ul>
          <div className="ml-auto flex items-center gap-3">
            <Link
              href={pathname}
              locale={other}
              lang={other}
              aria-label={t("switchLanguageLabel")}
              className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("switchLanguage")}
            </Link>
            <a
              href="#request"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {t("request")}
            </a>
          </div>
        </nav>
      </header>
    </>
  );
}
