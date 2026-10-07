import { type Locale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ScreeningNote } from "@/components/landing/ui";
import { ChainCheck } from "@/components/verify/ChainCheck";
import { Link } from "@/i18n/navigation";
import { makeFormat, pageAlternates, placeName } from "@/lib/format";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

/** Raw JSON, not a page: a plain link, so the browser downloads it. */
const ALL_ENTRIES = "/api/open/ledger?limit=1000";

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "Verify",
  });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: pageAlternates(locale, "/verify"),
  };
}

type Entry = {
  id: number;
  created_at: string;
  kind: "flag" | "confirmation" | "measure" | "meter" | "scorecard";
  payload_text: string;
  entry_hash: string;
};

/** The public face of the integrity ledger: what is in it, its Bitcoin anchors and a checker. */
export default async function VerifyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("Verify");
  const tp = await getTranslations("Places");
  const ta = await getTranslations("Dash.action.status");
  const tl = await getTranslations("Sustain.ledger.statuses");
  const f = makeFormat(locale);
  const supabase = supabaseConfigured ? await createClient() : null;
  const [recent, total, anchors] = supabase
    ? await Promise.all([
        supabase
          .from("ledger_entries")
          .select("id,created_at,kind,payload_text,entry_hash")
          .order("id", { ascending: false })
          .limit(20),
        supabase
          .from("ledger_entries")
          .select("id", { count: "exact", head: true }),
        supabase
          .from("ledger_anchors")
          .select(
            "id,created_at,up_to_entry,head_text,calendar,status,bitcoin_block,block_time",
          )
          .order("id", { ascending: false })
          .limit(12),
      ])
    : [null, null, null];
  const entries = (recent?.data ?? []) as Entry[];
  const anchorRows = anchors?.data ?? [];
  const confirmed = anchorRows.filter((a) => a.status === "confirmed");
  const site = (slug: unknown) =>
    placeName(tp as never, "sites", String(slug ?? ""), String(slug ?? ""));

  const summary = (e: Entry) => {
    const p = JSON.parse(e.payload_text) as Record<string, unknown>;
    switch (e.kind) {
      case "flag":
        return t("entry.flag", {
          site: site(p.site),
          tier: String(p.tier),
          date: String(p.pass_date),
        });
      case "confirmation":
        return t("entry.confirmation", {
          site: site(p.site),
          result: ta(String(p.result) as never),
        });
      case "measure":
        return t("entry.measure", {
          site: site(p.site),
          title: String(p.title),
          status: tl(String(p.status) as never),
        });
      case "meter":
        return t("entry.meter", {
          site: site(p.site),
          t: f.num(Number(p.ch4_destroyed_t), 1),
        });
      default:
        return t("entry.scorecard", { month: String(p.month).slice(0, 7) });
    }
  };

  return (
    <main id="main" className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-8">
          <Link href="/" className="font-heading text-lg font-semibold">
            Vayu<span className="text-signal">Netra</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/scorecard" className="hover:text-foreground">
              {t("scorecard")}
            </Link>
            <Link href="/map" className="hover:text-foreground">
              {t("map")}
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 md:px-8">
        <div className="space-y-3">
          <h1 className="font-heading text-3xl font-semibold text-canopy">
            {t("title")}
          </h1>
          <p className="max-w-3xl text-foreground/80">{t("intro")}</p>
        </div>

        <dl className="grid gap-3 sm:grid-cols-3">
          {[
            [t("stats.entries"), f.num(total?.count ?? 0)],
            [t("stats.anchors"), f.num(anchorRows.length)],
            [
              t("stats.bitcoin"),
              confirmed[0]?.bitcoin_block
                ? `#${confirmed[0].bitcoin_block}`
                : t("stats.waiting"),
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-border bg-card p-4"
            >
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd
                className={`mt-1 text-2xl text-canopy ${/\d/.test(value) ? "font-mono" : "font-heading"}`}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <ChainCheck
          anchors={anchorRows.map((a) => ({
            upTo: Number(a.up_to_entry),
            headText: String(a.head_text),
          }))}
        />

        <section
          aria-labelledby="anchors-title"
          className="rounded-xl border border-border bg-card p-5"
        >
          <h2 id="anchors-title" className="font-heading text-lg font-semibold">
            {t("anchors.title")}
          </h2>
          <p className="mt-1 text-sm text-foreground/80">
            {t("anchors.intro")}
          </p>
          {anchorRows.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("anchors.none")}
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4 font-medium">
                      {t("anchors.when")}
                    </th>
                    <th className="py-1 pr-4 font-medium">
                      {t("anchors.covers")}
                    </th>
                    <th className="py-1 pr-4 font-medium">
                      {t("anchors.calendar")}
                    </th>
                    <th className="py-1 pr-4 font-medium">
                      {t("anchors.status")}
                    </th>
                    <th className="py-1 font-medium">{t("anchors.files")}</th>
                  </tr>
                </thead>
                <tbody>
                  {anchorRows.map((a) => (
                    <tr key={a.id} className="border-t border-border align-top">
                      <td className="py-2 pr-4 font-mono text-xs">
                        {f.dateTime(a.created_at)}
                      </td>
                      <td className="py-2 pr-4">
                        {t("anchors.upTo", { n: Number(a.up_to_entry) })}
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {new URL(a.calendar).hostname}
                      </td>
                      <td className="py-2 pr-4">
                        {a.status === "confirmed" && a.bitcoin_block ? (
                          <a
                            href={`https://mempool.space/block/${a.bitcoin_block}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-tier-clear-ink underline"
                          >
                            {t("anchors.confirmed", {
                              block: String(a.bitcoin_block),
                            })}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">
                            {t("anchors.pending")}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-xs">
                        <a
                          href={`/api/open/ledger/proof/${a.id}?file=head`}
                          className="text-leaf underline"
                        >
                          .txt
                        </a>{" "}
                        ·{" "}
                        <a
                          href={`/api/open/ledger/proof/${a.id}`}
                          className="text-leaf underline"
                        >
                          .ots
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section
          aria-labelledby="entries-title"
          className="rounded-xl border border-border bg-card p-5"
        >
          <h2 id="entries-title" className="font-heading text-lg font-semibold">
            {t("recent")}
          </h2>
          <ol className="mt-3 space-y-2">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-baseline gap-x-3 text-sm"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  #{e.id}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {t(`kinds.${e.kind}`)}
                </span>
                <span>{summary(e)}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {e.entry_hash.slice(0, 16)}…
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            <a href={ALL_ENTRIES} className="text-leaf underline">
              {t("allEntries")}
            </a>
          </p>
        </section>

        <section aria-labelledby="how-title" className="space-y-2">
          <h2 id="how-title" className="font-heading text-lg font-semibold">
            {t("how.title")}
          </h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground/85">
            <li>{t("how.one")}</li>
            <li>{t("how.two")}</li>
            <li>
              {t.rich("how.three", {
                link: (chunks) => (
                  <a
                    href="https://opentimestamps.org"
                    target="_blank"
                    rel="noopener"
                    className="text-leaf underline"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </li>
          </ol>
          <p className="text-sm text-foreground/80">{t("scope")}</p>
        </section>
        <ScreeningNote />
      </div>
    </main>
  );
}
