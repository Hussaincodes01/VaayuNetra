"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import {
  formDate,
  formNumber,
  formText as text,
  requireRole,
  uploadAttachment,
  type Result,
} from "@/lib/dashboard-auth";
import {
  CAPTURE_KINDS,
  MEASURE_KINDS,
  MEASURE_STATUSES,
  parseDiversionCsv,
  type MeasureKind,
  type MeasureStatus,
} from "@/lib/sustainability";

const refresh = () => {
  revalidatePath("/[locale]/dashboard", "layout");
  revalidatePath("/[locale]/scorecard", "page");
};

const fail = (e: unknown): Result => ({
  ok: false,
  error: (e as Error).message,
});

/** Add or edit a mitigation measure. Expected tonnes are computed by the database, never sent. */
export async function saveMeasure(form: FormData): Promise<Result> {
  try {
    const { supabase } = await requireRole("officer");
    const id = text(form, "id", 64);
    const kind = text(form, "kind", 40) as MeasureKind;
    const status = (text(form, "status", 20) || "planned") as MeasureStatus;
    const share = formNumber(form, "captureSharePct");
    if (!MEASURE_KINDS.includes(kind) || !MEASURE_STATUSES.includes(status))
      return { ok: false, error: "invalid" };
    if (
      share !== null &&
      (!Number.isFinite(share) || share <= 0 || share > 100)
    )
      return { ok: false, error: "capture share must be 1–100%" };
    const row: Record<string, unknown> = {
      kind,
      title: text(form, "title", 200),
      agency: text(form, "agency", 200),
      status,
      start_date: formDate(form, "startDate"),
      capture_share:
        CAPTURE_KINDS.includes(kind) && share !== null ? share / 100 : null,
      other_programmes: text(form, "otherProgrammes", 500) || null,
      note: text(form, "note") || null,
    };
    if (!row.title || !row.agency) return { ok: false, error: "invalid" };
    if (status !== "planned" && !row.start_date)
      return { ok: false, error: "start date needed once work begins" };

    let measureId = id;
    if (id) {
      const { error } = await supabase
        .from("measures")
        .update(row)
        .eq("id", id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { data, error } = await supabase
        .from("measures")
        .insert({ ...row, site_id: text(form, "siteId", 64) })
        .select("id")
        .single();
      if (error) return { ok: false, error: error.message };
      measureId = String(data.id);
    }
    const path = await uploadAttachment(
      supabase,
      `measures/${measureId}`,
      form.get("evidence") as File | null,
    );
    if (path)
      await supabase
        .from("measures")
        .update({ evidence_url: path })
        .eq("id", measureId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Record legacy-waste remediation progress at a site (one row per date). */
export async function saveRemediation(form: FormData): Promise<Result> {
  try {
    const { supabase } = await requireRole("officer");
    const asOf = formDate(form, "asOf");
    const total = formNumber(form, "legacyTonnesTotal");
    const processed = formNumber(form, "tonnesProcessed");
    const area = formNumber(form, "areaReclaimedHa");
    const source = text(form, "source", 200);
    if (!asOf || processed === null || !source)
      return { ok: false, error: "invalid" };
    if (
      [total, processed, area].some(
        (v) => v !== null && (!Number.isFinite(v) || v < 0),
      )
    )
      return { ok: false, error: "numbers must be zero or more" };
    const { error } = await supabase.from("remediation_progress").upsert(
      {
        site_id: text(form, "siteId", 64),
        as_of: asOf,
        legacy_tonnes_total: total,
        tonnes_processed: processed,
        area_reclaimed_ha: area,
        source,
        note: text(form, "note", 1000) || null,
      },
      { onConflict: "site_id,as_of" },
    );
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** One month of wet waste diverted in a city. */
export async function saveDiversion(form: FormData): Promise<Result> {
  try {
    const { supabase } = await requireRole("officer");
    const city = text(form, "city", 100);
    const month = text(form, "month", 7);
    const composted = formNumber(form, "compostedT") ?? 0;
    const biogas = formNumber(form, "biogasT") ?? 0;
    const source = text(form, "source", 200);
    if (!city || !/^\d{4}-\d{2}$/.test(month) || !source)
      return { ok: false, error: "invalid" };
    if (![composted, biogas].every((v) => Number.isFinite(v) && v >= 0))
      return { ok: false, error: "tonnes must be zero or more" };
    const { error } = await supabase.from("diversion_monthly").upsert(
      {
        city,
        month: `${month}-01`,
        composted_t: composted,
        biogas_t: biogas,
        source,
        note: text(form, "note", 1000) || null,
      },
      { onConflict: "city,month" },
    );
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Import a city's monthly figures from CSV: month,composted_t,biogas_t. */
export async function importDiversionCsv(form: FormData): Promise<Result> {
  try {
    const { supabase } = await requireRole("officer");
    const city = text(form, "city", 100);
    const source = text(form, "source", 200);
    const file = form.get("file") as File | null;
    if (!city || !source || !file || file.size === 0)
      return { ok: false, error: "invalid" };
    if (file.size > 512 * 1024)
      return { ok: false, error: "CSV larger than 512 KB" };
    const { rows, errors } = parseDiversionCsv(await file.text());
    if (errors.length)
      return {
        ok: false,
        error: `check line ${errors.slice(0, 5).join(", ")}`,
      };
    if (!rows.length) return { ok: false, error: "no rows" };
    const { error } = await supabase.from("diversion_monthly").upsert(
      rows.map((r) => ({
        city,
        month: r.month,
        composted_t: r.compostedT,
        biogas_t: r.biogasT,
        source,
      })),
      { onConflict: "city,month" },
    );
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true, message: `rows:${rows.length}` };
  } catch (e) {
    return fail(e);
  }
}

/** Metered methane destroyed by a capture system; the database refuses it without a confirmed emission. */
export async function addMeterReading(form: FormData): Promise<Result> {
  try {
    const { supabase } = await requireRole("officer");
    const start = formDate(form, "periodStart");
    const end = formDate(form, "periodEnd");
    const tonnes = formNumber(form, "ch4DestroyedT");
    const meterId = text(form, "meterId", 100);
    if (
      !start ||
      !end ||
      tonnes === null ||
      !Number.isFinite(tonnes) ||
      tonnes <= 0 ||
      !meterId
    )
      return { ok: false, error: "invalid" };
    const { data, error } = await supabase
      .from("gas_meter_readings")
      .insert({
        site_id: text(form, "siteId", 64),
        measure_id: text(form, "measureId", 64) || null,
        period_start: start,
        period_end: end,
        ch4_destroyed_t: tonnes,
        meter_id: meterId,
        verified_by: text(form, "verifiedBy", 200) || null,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    const path = await uploadAttachment(
      supabase,
      `meters/${data.id}`,
      form.get("document") as File | null,
    );
    if (path)
      await supabase
        .from("gas_meter_readings")
        .update({ document_url: path })
        .eq("id", data.id);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Mark a FIRMS detection as a fire that is out, or as not a fire. */
export async function updateFire(form: FormData): Promise<Result> {
  try {
    const { supabase } = await requireRole("officer");
    const status = text(form, "status", 20);
    if (!["open", "out", "not_fire"].includes(status))
      return { ok: false, error: "invalid" };
    const patch: Record<string, unknown> = { status };
    if (form.has("note")) patch.note = text(form, "note", 1000) || null;
    const { error } = await supabase
      .from("fire_detections")
      .update(patch)
      .eq("id", text(form, "id", 64));
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Assign or close a citizen report. */
export async function updateReport(form: FormData): Promise<Result> {
  try {
    const { supabase } = await requireRole("officer");
    const id = text(form, "id", 64);
    const patch: Record<string, unknown> = {};
    if (form.has("assignee"))
      patch.assignee = text(form, "assignee", 64) || null;
    const status = text(form, "status", 10);
    if (status) {
      if (!["open", "closed"].includes(status))
        return { ok: false, error: "invalid" };
      patch.status = status;
    }
    if (form.has("closingNote"))
      patch.closing_note = text(form, "closingNote") || null;
    const path = await uploadAttachment(
      supabase,
      `reports/${id}`,
      form.get("closingPhoto") as File | null,
    );
    if (path) patch.closing_photo = path;
    if (patch.status === "closed" && !patch.closing_note)
      return { ok: false, error: "add what was done before closing" };
    const { error } = await supabase
      .from("citizen_reports")
      .update(patch)
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
