"use client";

import { Download } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getJson, type HardwareData } from "@/lib/ground/types";
import { CircuitSims } from "./CircuitSims";
import { ModelViewer } from "./ModelViewer";

const FAB = "/ground/fab";
const FILES = [
  {
    key: "gerbers",
    href: `${FAB}/VayuNetra_carrier_Gerbers_for_fab.zip`,
    size: "131 KB",
  },
  {
    key: "kicad",
    href: `${FAB}/VayuNetra_carrier_KiCad_project_3D.zip`,
    size: "1.3 MB",
  },
  { key: "step", href: `${FAB}/vn_carrier_assembled.step`, size: "8.6 MB" },
  { key: "wiring", href: `${FAB}/vn_node_wiring.csv`, size: "1 KB" },
  { key: "nodeGlb", href: "/ground/3d/vn_node_system.glb", size: "9.0 MB" },
  {
    key: "carrierGlb",
    href: "/ground/3d/vn_carrier_node.glb",
    size: "4.2 MB",
  },
  {
    key: "spiceSims",
    href: `${FAB}/VayuNetra_KiCad_simulations.zip`,
    size: "11 KB",
  },
  {
    key: "reliability",
    href: `${FAB}/VayuNetra_reliability_simulationsNode_Circuit_diagram.zip`,
    size: "16 KB",
  },
] as const;
const RENDERS = [
  "VayuNetra_carrier_3D_iso.png",
  "VayuNetra_carrier_3D_iso2.png",
  "VayuNetra_carrier_3D_top.png",
];
const BADGE = {
  ok: "bg-[#DCFCE7] text-tier-clear-ink",
  fixed: "bg-sky text-[#1F4A5C]",
  note: "bg-[#FEF3C7] text-tier-3-ink",
};

export function HardwareFab() {
  const t = useTranslations("Ground.hw");
  const [hw, setHw] = useState<HardwareData | null>(null);
  useEffect(() => {
    getJson<HardwareData>("/ground/data/hardware.json").then(
      setHw,
      () => undefined,
    );
  }, []);
  const card = "rounded-xl border border-border bg-card p-4";
  const h2 = "font-heading text-xl font-semibold text-canopy";
  const th = "py-1.5 pr-4 text-left font-medium text-muted-foreground";

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className={h2}>{t("title")}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("intro")}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <figure className="m-0 space-y-2">
            <ModelViewer
              src="/ground/3d/node_view.glb"
              label={t("node3d")}
              loadingText={t("loadingModel")}
            />
            <figcaption className="text-sm">
              <span className="font-medium text-canopy">{t("node3d")}</span>{" "}
              <span className="text-muted-foreground">· {t("viewerHelp")}</span>
            </figcaption>
          </figure>
          <figure className="m-0 space-y-2">
            <ModelViewer
              src="/ground/3d/carrier_view.glb"
              label={t("carrier3d")}
              loadingText={t("loadingModel")}
            />
            <figcaption className="text-sm">
              <span className="font-medium text-canopy">{t("carrier3d")}</span>{" "}
              <span className="text-muted-foreground">· {t("viewerHelp")}</span>
            </figcaption>
          </figure>
        </div>
      </section>

      <section className={`${card} space-y-4`} aria-labelledby="fab-title">
        <div>
          <h2 id="fab-title" className={h2}>
            {t("fab")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("fabHelp")}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {(["carrier_top.svg", "carrier_bottom.svg"] as const).map((f, i) => (
            <figure key={f} className="m-0 space-y-1">
              <Image
                src={`${FAB}/${f}`}
                alt={i ? t("gerberBottom") : t("gerberTop")}
                width={800}
                height={520}
                unoptimized
                className="h-auto w-full rounded-lg border border-border bg-white"
              />
              <figcaption className="text-sm text-muted-foreground">
                {i ? t("gerberBottom") : t("gerberTop")}
              </figcaption>
            </figure>
          ))}
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {FILES.map((f) => (
            <li key={f.key}>
              <a
                href={f.href}
                download
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:border-leaf"
              >
                <span className="flex items-center gap-2 text-leaf">
                  <Download className="size-4" aria-hidden />
                  {t(`files.${f.key}`)}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {f.size}
                </span>
              </a>
            </li>
          ))}
        </ul>
        <h3 className="font-heading text-base font-semibold text-canopy">
          {t("renders")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {RENDERS.map((r) => (
            <Image
              key={r}
              src={`${FAB}/${r}`}
              alt={`${t("carrier3d")}: ${r.replace(/\.png$/, "").replaceAll("_", " ")}`}
              width={640}
              height={480}
              className="h-auto w-full rounded-lg border border-border bg-white"
            />
          ))}
        </div>
      </section>

      {hw && (
        <section className={`${card} space-y-4`} aria-labelledby="pins-title">
          <div>
            <h2 id="pins-title" className={h2}>
              {t("pins")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("pinsHelp")}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>{t("signal")}</th>
                  <th className={th}>{t("pad")}</th>
                  <th className={th}>{t("espPin")}</th>
                  <th className={th}>{t("goesTo")}</th>
                </tr>
              </thead>
              <tbody>
                {hw.pins.map((p) => (
                  <tr key={p.signal} className="border-t border-border">
                    <td className="py-1.5 pr-4 font-mono">{p.signal}</td>
                    <td className="pr-4 font-mono">{p.pad}</td>
                    <td className="pr-4 font-mono">{p.pin}</td>
                    <td className="text-foreground/85">{p.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="font-heading text-base font-semibold text-canopy">
            {t("findings")}
          </h3>
          <ul className="space-y-2 text-sm">
            {hw.findings.map((f) => (
              <li key={f.key} className="flex flex-wrap items-start gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[f.kind]}`}
                >
                  {t(`kind.${f.kind}`)}
                </span>
                <span className="min-w-0 flex-1">
                  {t(`find.${f.key}` as Parameters<typeof t>[0])}
                </span>
              </li>
            ))}
          </ul>
          <h3 className="font-heading text-base font-semibold text-canopy">
            {t("firmware")}
          </h3>
          <p className="text-sm">
            {t("firmwareText", {
              checks: hw.firmware.checks,
              node: hw.firmware.node_flash_kb,
              ram: hw.firmware.ram_kb,
              gw: hw.firmware.gateway_flash_kb,
              wasm: hw.firmware.wasm_kb,
            })}
          </p>
        </section>
      )}

      <CircuitSims />

      {hw && (
        <section className={`${card} space-y-3`} aria-labelledby="mesh-title">
          <div>
            <h2 id="mesh-title" className={h2}>
              {t("mesh")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("meshHelp")}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>{t("topology")}</th>
                  <th className={th}>{t("radio")}</th>
                  <th className={th}>{t("dead")}</th>
                  <th className={th}>{t("delivered")}</th>
                  <th className={th}>{t("alarmBurst")}</th>
                  <th className={th}>{t("latency")}</th>
                </tr>
              </thead>
              <tbody>
                {hw.recorded.mesh.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-1.5 pr-4">{String(r.topology)}</td>
                    <td className="pr-4">{String(r.radio)}</td>
                    <td className="pr-4 font-mono">{String(r.dead_nodes)}</td>
                    <td className="pr-4 font-mono">
                      {String(r.delivery_pct)} %
                    </td>
                    <td className="pr-4 font-mono">
                      {String(r.alarm_burst_pct)} %
                    </td>
                    <td className="font-mono">
                      {String(r.latency_median_s)} s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="font-heading text-base font-semibold text-canopy">
            {t("wiring")}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {hw.recorded.wiring.map((w) => (
                  <tr key={w.Cable} className="border-t border-border">
                    <td className="py-1.5 pr-4 font-mono">{w.Cable}</td>
                    <td className="pr-4">{w.Function}</td>
                    <td className="pr-4 text-foreground/85">{w.From}</td>
                    <td className="pr-4 text-foreground/85">{w.To}</td>
                    <td className="text-xs text-muted-foreground">{w.Wires}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
