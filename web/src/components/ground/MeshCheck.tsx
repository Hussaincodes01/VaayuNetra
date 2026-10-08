"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { GroundSim, K, S } from "@/lib/ground/sim";
import { getJson, type HardwareData } from "@/lib/ground/types";

const SETTINGS: [string, number, number][] = [
  ["SF7 / 125 kHz", 7, 125_000],
  ["SF9 / 125 kHz", 9, 125_000],
  ["SF10 / 125 kHz", 10, 125_000],
  ["SF11 / 250 kHz", 11, 250_000],
];

type Row = {
  name: string;
  recorded: string;
  got: number;
  sent: number;
  airtime: number;
};

/**
 * The firmware's mesh against the hardware team's mesh.py: the same 12-node landfill ring, two
 * simulated hours per radio setting, three seeds, compared with their recorded delivery.
 */
export function MeshCheck({ fw }: { fw: WebAssembly.Module }) {
  const t = useTranslations("Ground.sim");
  const [mesh, setMesh] = useState<HardwareData["recorded"]["mesh"]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getJson<HardwareData>("/ground/data/hardware.json").then(
      (d) => setMesh(d.recorded.mesh),
      () => undefined,
    );
  }, []);

  const run = () => {
    setBusy(true);
    // Let the button show its busy state before the (synchronous, about a second) runs.
    setTimeout(() => {
      const out: Row[] = [];
      for (const [name, sf, bw] of SETTINGS) {
        let got = 0;
        let sent = 0;
        let air = 0;
        for (let seed = 1; seed <= 3; seed++) {
          const s = new GroundSim(fw);
          s.reset(seed, 1_736_138_400);
          s.set(K.sf, sf);
          s.set(K.bw, bw);
          s.set(K.plExp, 2.9);
          s.set(K.shadowDb, 6);
          s.set(K.leakKgph, 0);
          s.add("gateway", 450, 0, false, false);
          for (let i = 0; i < 12; i++) {
            const a = (2 * Math.PI * i) / 12;
            s.add("ring", 300 * Math.cos(a), 200 * Math.sin(a), false, true);
          }
          s.runUntil(2 * 3_600_000);
          got += s.state(0)[S.gwLines];
          for (let j = 1; j <= 12; j++) {
            const st = s.state(j);
            sent += st[S.reports];
            air = Math.max(
              air,
              st[S.airtime] / Math.max(1, st[S.txOwn] + st[S.txRelay]),
            );
          }
        }
        const prefix = `${name.split(" ")[0]} / ${bw / 1000}`;
        const rec = mesh.find(
          (r) =>
            String(r.topology).startsWith("landfill") &&
            String(r.radio).startsWith(prefix) &&
            Number(r.dead_nodes) === 0,
        );
        out.push({
          name,
          recorded: rec ? `${rec.delivery_pct} % (${rec.airtime_ms} ms)` : "–",
          got,
          sent,
          airtime: air,
        });
      }
      setRows(out);
      setBusy(false);
    }, 30);
  };

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h3 className="font-heading text-base font-semibold text-canopy">
        {t("validate")}
      </h3>
      <p className="max-w-3xl text-sm text-muted-foreground">
        {t("validateHelp")}
      </p>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md bg-leaf px-3 py-1.5 text-sm font-medium text-white hover:bg-leaf/90 disabled:opacity-60"
      >
        {t("validateRun")}
      </button>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-4">{t("radioSetting")}</th>
                <th className="pr-4 text-right">{t("recorded")}</th>
                <th className="pr-4 text-right">{t("thisFirmware")}</th>
                <th className="text-right">{t("airtime")}</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((r) => (
                <tr key={r.name} className="border-t border-border">
                  <td className="py-1 pr-4 font-sans">{r.name}</td>
                  <td className="pr-4 text-right">{r.recorded}</td>
                  <td className="pr-4 text-right">
                    {(
                      (100 * Math.min(r.got, r.sent)) /
                      Math.max(1, r.sent)
                    ).toFixed(1)}{" "}
                    % ({r.got}/{r.sent})
                  </td>
                  <td className="text-right">{Math.round(r.airtime)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
