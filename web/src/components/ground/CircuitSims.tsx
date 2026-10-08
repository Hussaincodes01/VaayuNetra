"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { LineChart } from "./LineChart";

type Gas = {
  v_ain0: number;
  mv_per_1pct_rs: number;
  ads_lsb_per_1pct_rs: number;
  settle_99_ms: number;
  curve_ms: number[];
  curve_v: number[];
};
type Droop = {
  min_v_heltec: number;
  curve_ms: number[];
  curve_v_heltec: number[];
};
type Energy = {
  summary: {
    gas_uptime: number;
    mesh_uptime: number;
    min_soc: number;
    days_gas_off: number;
    load_wh_day: number;
    harvest_wh_day: number;
    days: number;
  };
  daily: { date: string; soc_min: number }[];
};

/** Fetch one of the Pi's circuit models (api/ground.py), a quarter second after the last change. */
function useModel<T>(params: Record<string, string | number | boolean>): {
  data: T | null;
  failed: boolean;
} {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const key = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  useEffect(() => {
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/ground?${key}`, { signal: ctl.signal })
        .then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
        )
        .then((d: T) => {
          setData(d);
          setFailed(false);
        })
        .catch((e: Error) => e.name !== "AbortError" && setFailed(true));
    }, 250);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [key]);
  return { data, failed };
}

function Tile({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-border bg-cloud px-3 py-2">
      <p className="text-xs text-muted-foreground">{k}</p>
      <p className="font-mono text-lg font-semibold text-canopy">{v}</p>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-x-2 text-sm">
      <span>{label}</span>
      <output className="font-mono text-canopy">{value}</output>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="col-span-2 accent-leaf"
      />
    </label>
  );
}

export function CircuitSims() {
  const t = useTranslations("Ground.hw");
  const [rsK, setRsK] = useState(30);
  const [v5, setV5] = useState(5);
  const [bat, setBat] = useState(3.3);
  const [ptc, setPtc] = useState(0.25);
  const [fan, setFan] = useState(true);
  const [city, setCity] = useState("Delhi");
  const [panel, setPanel] = useState(6);
  const [cells, setCells] = useState(3);
  const [mcu, setMcu] = useState(12);
  const [pm, setPm] = useState(false);
  const [soil, setSoil] = useState(0.85);

  const gas = useModel<Gas>({ op: "gas", rs_ohm: rsK * 1000, v5 });
  const droop = useModel<Droop>({
    op: "droop",
    battery_v: bat,
    ptc_ohm: ptc,
    pm_fan_start: fan,
    cells: 3,
  });
  const energy = useModel<Energy>({
    op: "energy",
    city,
    panel_w: panel,
    cells,
    mcu_ma: mcu,
    pm,
    soil,
  });
  const card = "space-y-3 rounded-xl border border-border bg-card p-4";
  const wait = (f: boolean) => (
    <p className="text-sm text-muted-foreground">
      {f ? t("apiFailed") : t("computing")}
    </p>
  );

  return (
    <section className="space-y-4" aria-labelledby="sims-title">
      <div>
        <h2
          id="sims-title"
          className="font-heading text-xl font-semibold text-canopy"
        >
          {t("sims")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("simsHelp")}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <article className={card}>
          <h3 className="font-heading text-base font-semibold text-canopy">
            {t("gas")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("gasHelp")}</p>
          <Slider
            label={t("rs")}
            value={rsK}
            min={1}
            max={200}
            step={1}
            onChange={setRsK}
          />
          <Slider
            label={t("v5")}
            value={v5}
            min={4.5}
            max={5.5}
            step={0.05}
            onChange={setV5}
          />
          {gas.data ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile k={t("vain0")} v={`${gas.data.v_ain0.toFixed(4)} V`} />
                <Tile
                  k={t("perPct")}
                  v={`${gas.data.mv_per_1pct_rs.toFixed(2)} mV`}
                />
                <Tile
                  k={t("lsb")}
                  v={gas.data.ads_lsb_per_1pct_rs.toFixed(0)}
                />
                <Tile
                  k={t("settle")}
                  v={`${gas.data.settle_99_ms.toFixed(2)} ms`}
                />
              </div>
              <LineChart
                label={t("gasCurve")}
                x={gas.data.curve_ms}
                series={[
                  {
                    name: t("gasCurve"),
                    color: "#1E7B45",
                    values: gas.data.curve_v,
                  },
                ]}
                yLabel="V"
                xLabel="ms"
                height={200}
              />
            </>
          ) : (
            wait(gas.failed)
          )}
        </article>
        <article className={card}>
          <h3 className="font-heading text-base font-semibold text-canopy">
            {t("droop")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("droopHelp")}</p>
          <Slider
            label={t("batteryV")}
            value={bat}
            min={2.8}
            max={4.2}
            step={0.05}
            onChange={setBat}
          />
          <Slider
            label={t("ptc")}
            value={ptc}
            min={0}
            max={2}
            step={0.05}
            onChange={setPtc}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={fan}
              onChange={(e) => setFan(e.target.checked)}
              className="accent-leaf"
            />
            {t("fan")}
          </label>
          {droop.data ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Tile
                  k={t("minV")}
                  v={`${droop.data.min_v_heltec.toFixed(3)} V`}
                />
              </div>
              <LineChart
                label={t("droop")}
                x={droop.data.curve_ms}
                series={[
                  {
                    name: t("minV"),
                    color: "#4A86CF",
                    values: droop.data.curve_v_heltec,
                  },
                ]}
                threshold={{ value: 3.0, label: t("brownoutLimit") }}
                yLabel="V"
                xLabel="ms"
                height={200}
              />
            </>
          ) : (
            wait(droop.failed)
          )}
        </article>
      </div>
      <article className={card}>
        <h3 className="font-heading text-base font-semibold text-canopy">
          {t("energy")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("energyHelp")}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1 text-sm">
            {t("city")}
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded-md border border-border bg-card px-2 py-1.5"
            >
              <option>Delhi</option>
              <option>Mumbai</option>
            </select>
          </label>
          <Slider
            label={t("panelW")}
            value={panel}
            min={1}
            max={20}
            step={1}
            onChange={setPanel}
          />
          <Slider
            label={t("cells")}
            value={cells}
            min={2}
            max={3}
            step={1}
            onChange={setCells}
          />
          <Slider
            label={t("mcuMa")}
            value={mcu}
            min={5}
            max={80}
            step={1}
            onChange={setMcu}
          />
          <Slider
            label={t("soilLabel")}
            value={soil}
            min={0.4}
            max={1}
            step={0.05}
            onChange={setSoil}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pm}
              onChange={(e) => setPm(e.target.checked)}
              className="accent-leaf"
            />
            {t("pm")}
          </label>
        </div>
        {energy.data ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Tile
                k={t("gasUptime")}
                v={`${energy.data.summary.gas_uptime} %`}
              />
              <Tile
                k={t("meshUptime")}
                v={`${energy.data.summary.mesh_uptime} %`}
              />
              <Tile k={t("minSoc")} v={`${energy.data.summary.min_soc} %`} />
              <Tile
                k={t("daysGasOff")}
                v={String(energy.data.summary.days_gas_off)}
              />
              <Tile
                k={t("loadDay")}
                v={`${energy.data.summary.load_wh_day} Wh`}
              />
              <Tile
                k={t("harvestDay")}
                v={`${energy.data.summary.harvest_wh_day} Wh`}
              />
            </div>
            <LineChart
              label={t("socChart")}
              x={energy.data.daily.map((_, i) => i)}
              xFormat={(i) =>
                energy.data?.daily[Math.round(i)]?.date.slice(2) ?? ""
              }
              series={[
                {
                  name: t("socChart"),
                  color: "#1E7B45",
                  values: energy.data.daily.map((d) => d.soc_min),
                },
              ]}
              threshold={{ value: 25, label: "25 %" }}
              yMin={0}
              yMax={100}
              yLabel="%"
              height={220}
            />
          </>
        ) : (
          wait(energy.failed)
        )}
      </article>
    </section>
  );
}
