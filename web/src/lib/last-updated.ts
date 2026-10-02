import "server-only";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * When the newest scan was written to Supabase (ISO), or null when Supabase cannot be reached. Reads the
 * database, not the worker, so pages keep rendering while the worker is offline. Cached for a minute.
 */
export async function getLastUpdated(): Promise<string | null> {
  if (!SUPABASE_URL || !ANON_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/scans?select=created_at&order=created_at.desc&limit=1`,
      {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        next: { revalidate: 60, tags: ["last-updated"] },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { created_at: string }[];
    return rows[0]?.created_at ?? null;
  } catch {
    return null;
  }
}
