"use client";

import { LogOut } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { setLanguage, signOut } from "@/app/[locale]/dashboard/actions";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { Viewer } from "@/lib/dashboard-shared";
import { cn } from "@/lib/utils";

export function DashboardNav({ viewer }: { viewer: Viewer }) {
  const t = useTranslations("Dash.nav");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();
  const other = locale === "hi" ? "en" : "hi";
  const links = [
    { href: "/dashboard", label: t("overview") },
    { href: "/dashboard/sustainability", label: t("sustainability") },
    { href: "/dashboard/sensors", label: t("sensors") },
    { href: "/map", label: t("map") },
    ...(viewer.role === "admin"
      ? [{ href: "/dashboard/settings", label: t("settings") }]
      : []),
  ];

  const switchLanguage = () =>
    start(async () => {
      await setLanguage(other);
      router.replace(pathname, { locale: other });
    });

  return (
    <>
      <a
        href="#main"
        className="fixed top-2 left-2 z-50 -translate-y-20 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:translate-y-0"
      >
        {t("skip")}
      </a>
      <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <nav
          aria-label={t("label")}
          className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 md:px-8"
        >
          <Link
            href="/dashboard"
            className="font-heading text-lg font-semibold"
          >
            Vayu<span className="text-signal">Netra</span>
          </Link>
          <ul className="flex items-center gap-1 text-sm">
            {links.map((l) => {
              const active =
                l.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(l.href);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-md px-3 py-1.5 transition-colors hover:bg-muted",
                      active
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground sm:inline">
              {viewer.name || viewer.email} ·{" "}
              <span className="font-mono text-xs">
                {t(`role.${viewer.role}`)}
              </span>
            </span>
            <button
              type="button"
              onClick={switchLanguage}
              disabled={pending}
              lang={other}
              className="rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              {t("language")}
            </button>
            <form action={signOut}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground"
              >
                <LogOut className="size-4" aria-hidden />{" "}
                <span className="hidden sm:inline">{t("signOut")}</span>
              </button>
            </form>
          </div>
        </nav>
      </header>
    </>
  );
}
