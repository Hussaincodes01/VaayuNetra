"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard/ground", key: "flow" },
  { href: "/dashboard/ground/simulation", key: "simulation" },
  { href: "/dashboard/ground/hardware", key: "hardware" },
  { href: "/dashboard/ground/wind", key: "wind" },
  { href: "/dashboard/ground/satellite", key: "satellite" },
] as const;

/** Sub-navigation for the ground-network section. */
export function GroundTabs() {
  const t = useTranslations("Ground.tabs");
  const pathname = usePathname();
  return (
    <nav aria-label={t("flow")} className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border text-sm">
        {TABS.map((tab) => {
          const active =
            tab.href === "/dashboard/ground"
              ? pathname === tab.href
              : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-block border-b-2 px-3 py-2 transition-colors",
                  active
                    ? "border-leaf font-medium text-canopy"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t(tab.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
