import "server-only";

import {
  Document,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { roundCo2, type MonthlySummary } from "@/lib/alerts/compose";
import { makeFormat } from "@/lib/format";

// English PDF in the built-in Helvetica (WinAnsi): plain ASCII for units, so "CO2e" and "t/h".

const C = {
  night: "#05070D",
  teal: "#2DD4BF",
  text: "#111827",
  muted: "#4B5563",
  rule: "#E5E7EB",
  T1: "#DC2626",
  T2: "#A855F7",
  amberBg: "#FEF3C7",
  amberText: "#78350F",
};

const s = StyleSheet.create({
  page: {
    paddingTop: 0,
    paddingBottom: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: C.text,
  },
  band: {
    backgroundColor: C.night,
    paddingVertical: 18,
    paddingHorizontal: 36,
    marginBottom: 18,
  },
  brand: { color: "#E8ECF4", fontSize: 12, fontFamily: "Helvetica-Bold" },
  title: {
    color: "#FFFFFF",
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginTop: 8,
  },
  subtitle: { color: "#8A93A6", fontSize: 10, marginTop: 4 },
  body: { paddingHorizontal: 36 },
  h2: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginTop: 14,
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: C.rule,
    paddingVertical: 5,
  },
  head: { fontFamily: "Helvetica-Bold", color: C.muted, fontSize: 9 },
  cell: { paddingRight: 8 },
  num: { fontFamily: "Courier", fontSize: 10 },
  note: { color: C.muted, fontSize: 9, marginTop: 6, lineHeight: 1.4 },
  screening: {
    backgroundColor: C.amberBg,
    color: C.amberText,
    padding: 8,
    borderRadius: 4,
    marginTop: 16,
    fontSize: 9.5,
    lineHeight: 1.4,
  },
  empty: { color: C.muted, fontSize: 10, paddingVertical: 4 },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 8,
    color: C.muted,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

const TIER = {
  T1: "T1 methane-confident",
  T2: "T2 probable, needs confirmation",
} as const;
const OUTCOME = {
  resolved: "Resolved",
  not_methane: "Not methane (verification)",
} as const;
const SCREENING =
  "Screening-grade satellite estimate: confirm with a hyperspectral satellite, an OGI drone or a ground survey before enforcement or carbon crediting.";

function Table({
  widths,
  head,
  rows,
  numeric = [],
}: {
  widths: string[];
  head: string[];
  rows: string[][];
  numeric?: number[];
}) {
  return (
    <View>
      <View style={s.row}>
        {head.map((h, i) => (
          <Text key={h} style={[s.cell, s.head, { width: widths[i] }]}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((r, j) => (
        <View key={j} style={s.row} wrap={false}>
          {r.map((c, i) => (
            <Text
              key={i}
              style={[
                s.cell,
                numeric.includes(i) ? s.num : {},
                { width: widths[i] },
              ]}
            >
              {c}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Intl output can contain narrow / no-break spaces, which Helvetica's WinAnsi encoding lacks. */
const plain = (v: string) => v.replace(/[\u00a0\u202f\u2009]/g, " ");

function MonthlyReportDoc({
  r,
  generated,
}: {
  r: MonthlySummary;
  generated: Date;
}) {
  const base = makeFormat("en");
  const f = {
    ...base,
    dateTime: (iso: string) => plain(base.dateTime(iso)),
    date: (iso: string) => plain(base.date(iso)),
  };
  const month = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${r.period}-01T00:00:00Z`));
  const gwp = f.num(r.gwp100, Number.isInteger(r.gwp100) ? 0 : 1);
  const rate = (e: MonthlySummary["events"][number]) =>
    e.qMed !== null && e.qLo !== null && e.qHi !== null
      ? `about ${f.tph(e.qMed)} t/h (68% range ${f.tph(e.qLo)}-${f.tph(e.qHi)})`
      : (e.qMed ?? e.qKgph) !== null
        ? `about ${f.tph((e.qMed ?? e.qKgph)!)} t/h`
        : "not estimated";
  return (
    <Document
      title={`VayuNetra monthly report: ${r.state}, ${month}`}
      author="VayuNetra"
      subject="Sentinel-2 methane screening of Indian landfills"
      language="en"
    >
      <Page size="A4" style={s.page}>
        <View style={s.band}>
          <Text style={s.brand}>VayuNetra</Text>
          <Text style={s.title}>
            {r.state}: monthly report, {month}
          </Text>
          <Text style={s.subtitle}>
            Sentinel-2 methane screening of the monitored landfills. Generated{" "}
            {f.dateTime(generated.toISOString())} IST.
          </Text>
        </View>
        <View style={s.body}>
          <Text style={s.h2}>Summary</Text>
          <Table
            widths={["70%", "30%"]}
            head={["", "This month"]}
            numeric={[1]}
            rows={[
              ["Clear landfill passes scanned", f.num(r.passes)],
              [
                "Control passes (flags at control points)",
                `${f.num(r.controlPasses)} (${f.num(r.controlFlags)})`,
              ],
              ["T1 methane-confident", f.num(r.t1)],
              ["T2 probable, needs confirmation", f.num(r.t2)],
              ["T3 surface change, rejected as methane", f.num(r.t3)],
              ["Actions closed", f.num(r.actionsClosed)],
            ]}
          />

          <Text style={s.h2}>T1 and T2 events</Text>
          {r.events.length ? (
            <Table
              widths={["20%", "20%", "30%", "30%"]}
              head={["Pass date", "Site", "Tier", "Emission rate"]}
              rows={r.events.map((e) => [
                f.date(e.passDate),
                e.siteName,
                TIER[e.tier],
                rate(e),
              ])}
            />
          ) : (
            <Text style={s.empty}>No T1 or T2 events this month.</Text>
          )}

          <Text style={s.h2}>Actions closed</Text>
          {r.closed.length ? (
            <Table
              widths={["30%", "30%", "40%"]}
              head={["Closed", "Site", "Outcome"]}
              rows={r.closed.map((c) => [
                f.dateTime(c.at),
                c.siteName,
                OUTCOME[c.status],
              ])}
            />
          ) : (
            <Text style={s.empty}>No actions closed this month.</Text>
          )}

          <Text style={s.h2}>
            Minimum emission estimate (all passes to date)
          </Text>
          <Table
            widths={["40%", "30%", "30%"]}
            head={[
              "Site",
              "Min. time-averaged rate, kg/h",
              `t CO2e per year (GWP100 = ${gwp})`,
            ]}
            numeric={[1, 2]}
            rows={[
              ...r.sites.map((x) => [
                x.name,
                x.minMeanKgph ? f.num(x.minMeanKgph) : "not estimated",
                x.tco2e100Yr
                  ? `about ${f.num(roundCo2(x.tco2e100Yr))}`
                  : "not estimated",
              ]),
              [
                "State total",
                "",
                r.tco2e100Yr
                  ? `about ${f.num(roundCo2(r.tco2e100Yr))}`
                  : "not estimated",
              ],
            ]}
          />
          <Text style={s.note}>
            Minimum estimate: (T1 events / clear passes) x median T1 rate, i.e.
            zero on every pass without a T1 event, then x 8,760 h x GWP100 ={" "}
            {gwp} (IPCC AR6, non-fossil methane). Sites without a T1 event have
            no minimum estimate. Rounded to the nearest 1,000 t. This is a
            floor, not a measured total.
          </Text>
          <Text style={s.screening}>{SCREENING}</Text>
        </View>
        <View style={s.footer} fixed>
          <Text>
            VayuNetra · {r.state} · {month}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export async function monthlyReportPdf(
  r: MonthlySummary,
  generated = new Date(),
): Promise<Buffer> {
  return renderToBuffer(<MonthlyReportDoc r={r} generated={generated} />);
}
