"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { S, type GroundSim, type Role } from "@/lib/ground/sim";
import type { LabNode } from "@/lib/ground/types";
import type { Snapshot } from "./snapshot";

const fx = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : "–");

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="m-0 font-mono break-words">{children}</dd>
    </>
  );
}

/** Inside the selected node: power, the gas chain from ADC counts to ppm, met, radio, firmware log. */
export function NodeInspector({
  sim,
  snap,
  nodes,
  selected,
  roleLabel,
}: {
  sim: GroundSim | null;
  snap: Snapshot;
  nodes: LabNode[];
  selected: number;
  roleLabel: (r: Role) => string;
}) {
  const t = useTranslations("Ground.sim");
  const box =
    "max-h-[780px] overflow-y-auto rounded-xl border border-border bg-card p-3 text-xs";
  if (selected < 0 || !nodes[selected] || !sim)
    return (
      <aside className={box} aria-live="polite">
        <p className="text-sm text-muted-foreground">{t("clickNode")}</p>
      </aside>
    );
  const n = nodes[selected];
  const s = snap.states[selected];
  const gw = n.role === "gateway";
  const state = !s[S.alive]
    ? t("stopped")
    : s[S.brownout]
      ? t("brownout")
      : s[S.on]
        ? t("running")
        : t("sleeping");
  const h4 = "mt-3 mb-1 font-heading text-sm font-semibold text-canopy";
  const dl = "grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5";
  return (
    <aside className={box} aria-live="polite">
      <h3 className="font-heading text-base font-semibold text-canopy">
        {n.id} · {roleLabel(n.role)}
      </h3>
      <p className="font-mono text-muted-foreground">{n.radio_id}</p>
      <dl className={`${dl} mt-2`}>
        <Row k={t("state")}>{state}</Row>
        {!gw && (
          <>
            <Row k={t("battery")}>
              {fx(100 * s[S.soc], 1)} % · {fx(s[S.vbat], 2)} V
            </Row>
            <Row k={t("solarLoad")}>
              {fx(s[S.harvest], 2)} W / {fx(s[S.load], 3)} W
            </Row>
            <Row k={t("heater")}>
              {t("heaterWants")} {s[S.heaterWant] ? t("on") : t("off")},{" "}
              {t("heaterIs")} {s[S.heater] ? t("on") : t("off")}
            </Row>
            <Row k={t("nodeState")}>
              {t(`ev${Math.min(2, s[S.ev])}` as "ev0")}
            </Row>
            <Row k={t("nextReport")}>{fx(s[S.nextReport], 0)} s</Row>
          </>
        )}
      </dl>
      {!gw && (
        <>
          <h4 className={h4}>{t("gasChain")}</h4>
          <dl className={dl}>
            <Row k={t("truePpm")}>{fx(s[S.truePpm], 2)} ppm</Row>
            <Row k={t("sensorRs")}>{fx(s[S.rsOhm] / 1000, 2)} kΩ</Row>
            <Row k="ADS1115 AIN0">
              {s[S.ads0]} = {fx(s[S.vain0] * 1000, 2)} mV
            </Row>
            <Row k="AIN3 (5 V ÷ 2)">
              {s[S.ads3]} → {fx(s[S.v5], 3)} V
            </Row>
            <Row k="Rs/R0">{fx(s[S.rsRatio], 4)}</Row>
            <Row k={t("estPpm")}>{fx(s[S.ppm], 2)} ppm</Row>
            <Row k={t("baseline")}>
              {fx(s[S.base], 2)} ppm{s[S.haveBase] ? "" : ` (${t("learning")})`}
            </Row>
            <Row k={t("excess")}>{fx(s[S.excess], 2)} ppm</Row>
            <Row k="AIN1 / AIN2">
              {s[S.ads1]} / {s[S.ads2]} · {fx(s[S.vsol], 2)} V
            </Row>
          </dl>
          <h4 className={h4}>{t("metPm")}</h4>
          <dl className={dl}>
            <Row k={t("rawCounts")}>
              {s[S.rawT]} / {s[S.rawP]} / {s[S.rawH]}
            </Row>
            <Row k="→">
              {fx(s[S.tC], 2)} °C · {fx(s[S.rh], 1)} % · {fx(s[S.p], 2)} hPa
            </Row>
            <Row k="PM2.5">
              {fx(s[S.pm], 0)} µg/m³ ({fx(s[S.pmTrue], 0)})
              {s[S.pmsOn] ? ` · ${t("pmFan")}` : ""}
            </Row>
            {s[S.hasWind] === 1 && (
              <Row k={t("windSensor")}>
                {s[S.pulses]} · {s[S.vane]} mV · {fx(s[S.ws], 1)} m/s ·{" "}
                {fx(s[S.wd], 0)}°
              </Row>
            )}
          </dl>
        </>
      )}
      <h4 className={h4}>{t("radioCounts")}</h4>
      <dl className={dl}>
        <Row k={t("sentRelayed")}>
          {s[S.txOwn]} / {s[S.txRelay]}
        </Row>
        <Row k={t("heardDup")}>
          {s[S.rx]} / {s[S.dup]}
        </Row>
        <Row k={t("cancelledBusy")}>
          {s[S.supp]} / {s[S.backoff]}
        </Row>
        <Row k={t("airtime")}>
          {fx(s[S.airtime] / 1000, 1)} s (
          {fx((100 * s[S.airtime]) / Math.max(1, snap.simMs), 3)} %)
        </Row>
      </dl>
      {!gw && (
        <>
          <h4 className={h4}>{t("payload")}</h4>
          <pre className="rounded-lg border border-border bg-cloud p-2 font-mono text-[11px] break-all whitespace-pre-wrap">
            {sim.payload(selected) || "–"}
          </pre>
        </>
      )}
      <h4 className={h4}>{t("trace")}</h4>
      <pre className="rounded-lg border border-border bg-cloud p-2 font-mono text-[11px] break-all whitespace-pre-wrap">
        {sim.trace(selected).join("\n")}
      </pre>
    </aside>
  );
}
