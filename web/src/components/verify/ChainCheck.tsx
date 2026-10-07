"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

type Entry = {
  id: number;
  payload_text: string;
  payload_hash: string;
  prev_hash: string;
  entry_hash: string;
};

const ZERO = "0".repeat(64);

async function hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type State =
  | { phase: "idle" }
  | { phase: "running"; checked: number }
  | { phase: "ok"; checked: number; head: string; anchors: number }
  | {
      phase: "broken";
      id: number;
      reason: "payload" | "entry" | "link" | "order" | "anchor";
    }
  | { phase: "error"; message: string };

/**
 * Re-checks the integrity ledger in the visitor's browser: downloads every entry, recomputes each
 * payload and entry hash with Web Crypto, follows the prev_hash links, and confirms that each
 * anchored head ("vayunetra-ledger:<id>:<hash>") matches the chain.
 */
export function ChainCheck({
  anchors,
}: {
  anchors: { upTo: number; headText: string }[];
}) {
  const t = useTranslations("Verify.check");
  const [state, setState] = useState<State>({ phase: "idle" });

  const run = async () => {
    setState({ phase: "running", checked: 0 });
    try {
      const hashes = new Map<number, string>();
      let prev = ZERO;
      let expectId = 1;
      let after = 0;
      for (;;) {
        const res = await fetch(`/api/open/ledger?after=${after}&limit=1000`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { entries, next } = (await res.json()) as {
          entries: Entry[];
          next: number | null;
        };
        for (const e of entries) {
          if (e.id !== expectId)
            return setState({ phase: "broken", id: e.id, reason: "order" });
          if ((await hex(e.payload_text)) !== e.payload_hash)
            return setState({ phase: "broken", id: e.id, reason: "payload" });
          if (e.prev_hash !== prev)
            return setState({ phase: "broken", id: e.id, reason: "link" });
          if (
            (await hex(`${e.prev_hash}|${e.id}|${e.payload_hash}`)) !==
            e.entry_hash
          )
            return setState({ phase: "broken", id: e.id, reason: "entry" });
          hashes.set(e.id, e.entry_hash);
          prev = e.entry_hash;
          expectId++;
        }
        setState({ phase: "running", checked: expectId - 1 });
        if (next === null) break;
        after = next;
      }
      for (const a of anchors) {
        if (a.headText !== `vayunetra-ledger:${a.upTo}:${hashes.get(a.upTo)}`)
          return setState({ phase: "broken", id: a.upTo, reason: "anchor" });
      }
      setState({
        phase: "ok",
        checked: expectId - 1,
        head: prev,
        anchors: anchors.length,
      });
    } catch (e) {
      setState({ phase: "error", message: (e as Error).message });
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-heading text-lg font-semibold">{t("title")}</h2>
      <p className="mt-1 text-sm text-foreground/80">{t("intro")}</p>
      <button
        type="button"
        onClick={run}
        disabled={state.phase === "running"}
        className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {state.phase === "running"
          ? t("running", { n: state.checked })
          : t("run")}
      </button>
      <div role="status" aria-live="polite" className="mt-3 text-sm">
        {state.phase === "ok" && (
          <p className="text-tier-clear-ink">
            {t("ok", { n: state.checked, anchors: state.anchors })}{" "}
            <span className="font-mono text-xs break-all">{state.head}</span>
          </p>
        )}
        {state.phase === "broken" && (
          <p className="text-tier-1-ink">
            {t(`broken.${state.reason}`, { id: state.id })}
          </p>
        )}
        {state.phase === "error" && (
          <p className="text-tier-1-ink">
            {t("error", { reason: state.message })}
          </p>
        )}
      </div>
    </div>
  );
}
