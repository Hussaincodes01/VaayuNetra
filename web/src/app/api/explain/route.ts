import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { getSiteDetail, getViewer } from "@/lib/dashboard-data";
import { allowedNumbers, siteFacts, strayNumbers } from "@/lib/explain";
import { rateLimit } from "@/lib/rate-limit";
import {
  createAdminClient,
  createClient,
  serviceRoleConfigured,
} from "@/lib/supabase/server";
import { WORDING_RULES } from "@/lib/wording-rules";
import hi from "../../../../messages/hi.json";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";

async function groq(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 500,
    }),
    cache: "no-store",
  });
  if (!res.ok)
    throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return json.choices[0]?.message?.content?.trim() ?? "";
}

/** The site's official Hindi spellings (messages/hi.json, Places), so the model does not transliterate. */
function hindiNames(site: {
  slug: string;
  name: string;
  city: string;
  state: string;
}) {
  const places = hi.Places as {
    sites: Record<string, string>;
    regions: Record<string, string>;
  };
  const pairs = [
    ["VayuNetra", "वायुनेत्र"],
    [site.name, places.sites[site.slug]],
    [site.city, places.regions[site.city]],
    [site.state, places.regions[site.state]],
  ].filter((pair): pair is [string, string] => Boolean(pair[1]));
  return `Use these Hindi spellings exactly: ${pairs.map(([en, h]) => `${en} = ${h}`).join("; ")}.`;
}

/** POST {slug, lang} -> a ~150-word briefing that uses only numbers from the site's JSON. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer)
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const { slug, lang } = (await request.json().catch(() => ({}))) as {
    slug?: string;
    lang?: string;
  };
  const language = lang === "hi" ? "hi" : "en";
  const detail = slug ? await getSiteDetail(supabase, slug) : null;
  if (!detail)
    return NextResponse.json({ error: "unknown site" }, { status: 404 });
  const { site, scans, briefings } = detail;

  const cached = briefings.find((b) => b.lang === language);
  if (cached) return NextResponse.json({ briefing: cached });
  if (!process.env.GROQ_API_KEY)
    return NextResponse.json(
      { error: "GROQ_API_KEY is not set" },
      { status: 503 },
    );

  // Every uncached briefing is a paid LLM call: 10 per user and 100 overall per hour.
  for (const [key, max] of [
    [`explain:user:${viewer.id}`, 10],
    ["explain:all", 100],
  ] as const) {
    const limit = await rateLimit(key, max, 3600);
    if (!limit.ok)
      return NextResponse.json(
        { error: "rate limited" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
  }

  const { data: gwpRows } = await supabase
    .from("settings")
    .select("key,value")
    .in("key", ["gwp100", "gwp20"]);
  const facts = siteFacts(site, scans, {
    g100: Number(gwpRows?.find((r) => r.key === "gwp100")?.value ?? 27),
    g20: Number(gwpRows?.find((r) => r.key === "gwp20")?.value ?? 79.7),
  });
  const allowed = allowedNumbers(facts);
  const system = [
    "You brief Indian officials (MoHUA, CPCB/SPCBs, municipal corporations) on one landfill monitored by VayuNetra,",
    "a Sentinel-2 methane screening system. Follow these wording rules exactly:",
    WORDING_RULES,
    `Write one plain paragraph of about 150 words in ${language === "hi" ? "Hindi (Devanagari script, Latin digits)" : "English"}.`,
    ...(language === "hi" ? [hindiNames(site)] : []),
    "Use only numbers that appear in the JSON, written the same way; do not calculate new numbers or percentages.",
    "Say what the evidence shows, what is uncertain, and the next step (confirmation before any enforcement).",
    "No headings, lists or markdown.",
  ].join("\n");
  const user = `Site JSON:\n${JSON.stringify(facts, null, 1)}`;

  try {
    let text = await groq([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    let stray = strayNumbers(text, allowed);
    if (stray.length) {
      text = await groq([
        { role: "system", content: system },
        { role: "user", content: user },
        { role: "assistant", content: text },
        {
          role: "user",
          content: `These numbers are not in the JSON: ${stray.join(", ")}. Rewrite the paragraph using only numbers from the JSON.`,
        },
      ]);
      stray = strayNumbers(text, allowed);
    }
    if (stray.length) {
      return NextResponse.json(
        {
          error: `the model used numbers not in the site data (${stray.join(", ")})`,
        },
        { status: 422 },
      );
    }
    const briefing = {
      lang: language,
      briefing: text,
      model: MODEL,
      created_at: new Date().toISOString(),
    };
    if (serviceRoleConfigured) {
      await createAdminClient().from("ai_briefings").upsert(
        {
          site_id: site.id,
          model_version: site.modelVersion,
          lang: language,
          model: MODEL,
          briefing: text,
        },
        { onConflict: "site_id,model_version,lang" },
      );
    }
    return NextResponse.json({ briefing });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
