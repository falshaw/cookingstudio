// CGM CSV import: FreeStyle Libre (LibreView export) and Dexcom Clarity export. Pure parsing.
// Timestamps in both exports are local wall-clock time without a zone; they are stored as-is
// (as if UTC) and shown as-is, so a reading at 08:15 is shown at 08:15. Values in mmol/L are
// converted to mg/dL (× 18.016). Health data — stays in this database.

export interface Reading {
  at: Date;
  mgdl: number;
}

export interface ParsedGlucose {
  source: "libre" | "dexcom";
  readings: Reading[];
  skipped: number;
}

const MMOL_TO_MGDL = 18.016;

/** CSV line → fields (handles quoted fields with commas and doubled quotes). */
export function splitCsv(line: string, sep = ","): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const pad = (n: number) => String(n).padStart(2, "0");
function mkDate(y: number, mo: number, d: number, h: number, mi: number, s = 0): Date | null {
  if (!(y > 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h < 24 && mi >= 0 && mi < 60)) return null;
  const dt = new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}Z`);
  return isNaN(dt.getTime()) ? null : dt;
}

/** Libre: "DD-MM-YYYY HH:MM" (EU export) or "MM-DD-YYYY hh:mm AM" (US export), also with "/" or "." */
export function parseLibreTime(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) {
    const iso = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    return iso ? mkDate(+iso[1], +iso[2], +iso[3], +iso[4], +iso[5], +(iso[6] ?? 0)) : null;
  }
  const [, d1, d2, y, h, mi, sec, ap] = m;
  let a = d1;
  let b = d2;
  let hour = +h;
  if (ap) {
    // US export: month first, 12-hour clock
    if (ap.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (ap.toUpperCase() === "AM" && hour === 12) hour = 0;
    [a, b] = [b, a];
  }
  return mkDate(+y, +b, +a, hour, +mi, +(sec ?? 0));
}

export function parseGlucoseCsv(text: string): ParsedGlucose {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const sep = lines.slice(0, 5).some((l) => l.split(";").length > l.split(",").length) ? ";" : ",";
  // LibreView exports in the reader's locale; the second alternative of each header match is a
  // non-English column name (non-ASCII letters written as \u escapes).
  const headerIdx = lines.findIndex((l) => /Device Timestamp|Ger\u00e4tezeitstempel/i.test(l) ||/Timestamp \(YYYY-MM-DDThh:mm:ss\)/i.test(l));
  if (headerIdx < 0) throw new Error("Not a FreeStyle Libre or Dexcom Clarity CSV export (no timestamp header found)");
  const header = splitCsv(lines[headerIdx], sep);
  const readings: Reading[] = [];
  let skipped = 0;
  const num = (s: string | undefined) => {
    const v = parseFloat((s ?? "").replace(",", "."));
    return isFinite(v) ? v : null;
  };
  if (/Timestamp \(YYYY-MM-DDThh:mm:ss\)/i.test(lines[headerIdx])) {
    // Dexcom Clarity
    const ti = header.findIndex((h) => /^Timestamp/i.test(h));
    const ei = header.findIndex((h) => /^Event Type/i.test(h));
    const gi = header.findIndex((h) => /^Glucose Value/i.test(h));
    const mmol = /mmol/i.test(header[gi] ?? "");
    for (const l of lines.slice(headerIdx + 1)) {
      const f = splitCsv(l, sep);
      if (ei >= 0 && f[ei] !== "EGV") continue;
      const v = num(f[gi]);
      const at = parseLibreTime((f[ti] ?? "").replace("T", " "));
      if (v == null || !at) {
        skipped++;
        continue;
      }
      readings.push({ at, mgdl: Math.round(mmol ? v * MMOL_TO_MGDL : v) });
    }
    return { source: "dexcom", readings, skipped };
  }
  // FreeStyle Libre: Record Type 0 = historic (every 15 min), 1 = scan
  const ti = header.findIndex((h) => /Device Timestamp|Ger\u00e4tezeitstempel/i.test(h));
  const ri = header.findIndex((h) => /Record Type|Aufzeichnungstyp/i.test(h));
  const hi = header.findIndex((h) => /^Historic Glucose|^Glukosewert-Verlauf/i.test(h));
  const si = header.findIndex((h) => /^Scan Glucose|^Glukose-Scan/i.test(h));
  const mmol = /mmol/i.test(header[hi] ?? header[si] ?? "");
  for (const l of lines.slice(headerIdx + 1)) {
    const f = splitCsv(l, sep);
    const type = f[ri];
    const raw = type === "0" ? f[hi] : type === "1" ? f[si] : undefined;
    if (raw === undefined) continue; // notes, insulin, food records
    const v = num(raw);
    const at = parseLibreTime(f[ti] ?? "");
    if (v == null || !at) {
      skipped++;
      continue;
    }
    readings.push({ at, mgdl: Math.round(mmol ? v * MMOL_TO_MGDL : v) });
  }
  return { source: "libre", readings, skipped };
}

/** Day summary: average and share of readings inside the consensus 70–180 mg/dL band. */
export function daySummary(readings: Reading[]): { avg: number; inRange: number; min: number; max: number } | null {
  if (!readings.length) return null;
  const vals = readings.map((r) => r.mgdl);
  return {
    avg: Math.round(vals.reduce((a, v) => a + v, 0) / vals.length),
    inRange: Math.round((vals.filter((v) => v >= 70 && v <= 180).length / vals.length) * 100),
    min: Math.min(...vals),
    max: Math.max(...vals),
  };
}
