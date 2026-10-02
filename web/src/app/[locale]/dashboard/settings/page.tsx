import type { Locale } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { InviteForm, SettingsForm } from "@/components/dashboard/SettingsForms";
import { getViewer } from "@/lib/dashboard-data";
import { makeFormat } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

// Per-user data (session cookie): never prerender.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "Dash.settings",
  });
  return { title: t("title") };
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  const t = await getTranslations("Dash.settings");
  if (viewer?.role !== "admin") {
    return (
      <p className="rounded-xl border border-white/10 bg-card p-6 text-sm">
        {t("adminOnly")}
      </p>
    );
  }
  const f = makeFormat(await getLocale());
  const [settings, requests, profiles] = await Promise.all([
    supabase.from("settings").select("key,value"),
    supabase
      .from("access_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("profiles")
      .select("user_id,full_name,org,state,role,lang")
      .order("full_name"),
  ]);
  const values = Object.fromEntries(
    (settings.data ?? []).map((r) => [r.key, r.value]),
  );

  return (
    <div className="space-y-8">
      <h1 className="font-heading text-3xl font-semibold">{t("title")}</h1>
      <SettingsForm settings={values} />

      <section
        aria-labelledby="users-title"
        className="rounded-xl border border-white/10 bg-card p-5"
      >
        <h2 id="users-title" className="font-heading text-lg font-semibold">
          {t("invite")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("inviteNote")}</p>
        <div className="mt-4">
          <InviteForm />
        </div>
        <h3 className="mt-6 text-sm font-semibold">{t("users")}</h3>
        <ul className="mt-2 divide-y divide-white/5 text-sm">
          {(profiles.data ?? []).map((p) => (
            <li key={p.user_id} className="flex flex-wrap gap-x-4 py-2">
              <span className="font-medium">{p.full_name || "—"}</span>
              <span className="text-muted-foreground">
                {[p.org, p.state].filter(Boolean).join(" · ")}
              </span>
              <span className="ml-auto font-mono text-xs">
                {t(`roles.${p.role as "viewer" | "officer" | "admin"}`)} ·{" "}
                {p.lang}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="requests-title"
        className="rounded-xl border border-white/10 bg-card p-5"
      >
        <h2 id="requests-title" className="font-heading text-lg font-semibold">
          {t("requests")}
        </h2>
        {(requests.data ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t("noRequests")}
          </p>
        ) : (
          <ul className="mt-3 space-y-4">
            {(requests.data ?? []).map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-white/10 p-4 text-sm"
              >
                <p>
                  <span className="font-medium">{r.name}</span> · {r.org}
                  {r.state && <> · {r.state}</>} ·{" "}
                  <span className="font-mono text-xs">{r.email}</span>
                </p>
                {r.message && (
                  <p className="mt-1 text-foreground/80">{r.message}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {f.dateTime(r.created_at)}
                </p>
                <div className="mt-3">
                  <InviteForm
                    preset={{
                      email: r.email,
                      name: r.name,
                      org: r.org,
                      state: r.state,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
