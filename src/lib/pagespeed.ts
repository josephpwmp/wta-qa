/**
 * Google PageSpeed Insights API v5 — parse performance score, LCP, CLS, FID/INP.
 * @see https://developers.google.com/speed/docs/insights/v5/get-started
 */

export type PageSpeedStrategy = "mobile" | "desktop";

export type PageSpeedStrategyResult = {
  strategy: PageSpeedStrategy;
  /** Lighthouse performance category score 0–100 */
  performanceScore: number | null;
  /** Lab: Largest Contentful Paint (ms) */
  lcpMs: number | null;
  lcpDisplay: string | null;
  /** Lab: Cumulative Layout Shift (unitless) */
  cls: number | null;
  clsDisplay: string | null;
  /**
   * FID (ms). Prefer CrUX field 75th percentile when present; else lab audits (first-input-delay / max-potential-fid).
   * Core Web Vitals now emphasize INP over FID; we still surface FID when the API provides it.
   */
  fidMs: number | null;
  fidDisplay: string | null;
  fidSource: "field" | "lab" | "none";
  /** Interaction to Next Paint (ms) when Lighthouse exposes it */
  inpMs: number | null;
  inpDisplay: string | null;
};

type UnknownRecord = Record<string, unknown>;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function getAudit(lhr: UnknownRecord | undefined, id: string): UnknownRecord | undefined {
  const audits = lhr?.audits as UnknownRecord | undefined;
  const a = audits?.[id];
  return typeof a === "object" && a !== null ? (a as UnknownRecord) : undefined;
}

function getMetricPercentile(
  loading: UnknownRecord | undefined,
  id: string,
): number | null {
  const metrics = loading?.metrics as UnknownRecord | undefined;
  const m = metrics?.[id] as UnknownRecord | undefined;
  return num(m?.percentile);
}

export function parsePageSpeedResponse(
  json: unknown,
  strategy: PageSpeedStrategy,
): PageSpeedStrategyResult {
  const root = json as UnknownRecord;
  const lhr = root?.lighthouseResult as UnknownRecord | undefined;
  const loading = root?.loadingExperience as UnknownRecord | undefined;

  const perfCat = lhr?.categories as UnknownRecord | undefined;
  const performance = perfCat?.performance as UnknownRecord | undefined;
  const perfScoreRaw = performance?.score;
  const performanceScore =
    typeof perfScoreRaw === "number" && Number.isFinite(perfScoreRaw)
      ? Math.round(perfScoreRaw * 100)
      : null;

  const lcpAudit = getAudit(lhr, "largest-contentful-paint");
  const clsAuditFixed = getAudit(lhr, "cumulative-layout-shift");

  const lcpMs = num(lcpAudit?.numericValue);
  const lcpDisplay = typeof lcpAudit?.displayValue === "string" ? lcpAudit.displayValue : null;

  const cls = num(clsAuditFixed?.numericValue);
  const clsDisplay =
    typeof clsAuditFixed?.displayValue === "string" ? clsAuditFixed.displayValue : null;

  // FID: field (CrUX) first
  let fidMs = getMetricPercentile(loading, "FIRST_INPUT_DELAY_MS");
  let fidSource: PageSpeedStrategyResult["fidSource"] = fidMs != null ? "field" : "none";
  let fidDisplay: string | null = fidMs != null ? `${Math.round(fidMs)} ms (field p75)` : null;

  if (fidMs == null) {
    const fidLab = getAudit(lhr, "first-input-delay") ?? getAudit(lhr, "max-potential-fid");
    fidMs = num(fidLab?.numericValue);
    if (fidMs != null) {
      fidSource = "lab";
      fidDisplay =
        typeof fidLab?.displayValue === "string"
          ? `${fidLab.displayValue} (lab)`
          : `${Math.round(fidMs)} ms (lab)`;
    }
  }

  const inpAudit = getAudit(lhr, "interaction-to-next-paint");
  let inpMs = num(inpAudit?.numericValue);
  let inpDisplay =
    typeof inpAudit?.displayValue === "string" ? inpAudit.displayValue : null;

  if (inpMs == null && inpDisplay == null) {
    const inpField = getMetricPercentile(loading, "INTERACTION_TO_NEXT_PAINT");
    if (inpField != null) {
      inpMs = inpField;
      inpDisplay = `${Math.round(inpField)} ms (field p75)`;
    }
  }

  return {
    strategy,
    performanceScore,
    lcpMs,
    lcpDisplay,
    cls,
    clsDisplay,
    fidMs,
    fidDisplay,
    fidSource,
    inpMs,
    inpDisplay,
  };
}
