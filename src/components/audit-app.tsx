"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { CoreAudit } from "@/lib/audit";
import type {
  ImageAltRow,
  LegalLinkVerified,
  SchemaCheckResult,
} from "@/lib/audit-extras";
import type { PageSpeedStrategyResult } from "@/lib/pagespeed";
import type { ConsoleCheckResult } from "@/lib/console-check";

type PageSpeedBundle = {
  url: string;
  markdown: string;
  mobile: PageSpeedStrategyResult;
  desktop: PageSpeedStrategyResult;
};

type ConsoleBundle = ConsoleCheckResult & { markdown: string };

type AuditResponse = {
  url: string;
  finalUrl: string;
  coreAudit: CoreAudit;
  markdown: string;
  schemaCheck: SchemaCheckResult;
  imageAltList: ImageAltRow[];
  legalPages: { privacy: LegalLinkVerified[]; terms: LegalLinkVerified[] };
};

const TEXT = "#08457c";
const BTN = "#bc0400";
const LINK = "#22d3ee";

const ROW_ORDER: (keyof CoreAudit)[] = [
  "Indexable",
  "Followable",
  "Canonical",
  "Canonical count",
  "Canonical valid",
  "Canonical same host",
  "Title",
  "Description",
  "Desc chars",
  "H1 count",
  "Robots",
  "tel links",
  "mailto links",
];

/** Shorter labels for cards */
const LABEL_PRETTY: Partial<Record<keyof CoreAudit, string>> = {
  "Canonical count": "Canonical tags",
  "Canonical valid": "Canonical URL valid",
  "Canonical same host": "Canonical on same host",
  "Desc chars": "Meta description length",
  "tel links": "tel: links",
  "mailto links": "mailto: links",
};

type RowStatus = "pass" | "warn" | "fail" | "neutral";

function assessRow(key: keyof CoreAudit, data: CoreAudit): { status: RowStatus; hint?: string } {
  const v = data[key];
  switch (key) {
    case "Indexable":
      return v === "Yes" ? { status: "pass" } : { status: "fail", hint: "Page may be noindexed" };
    case "Followable":
      return v === "Yes" ? { status: "pass" } : { status: "warn", hint: "nofollow in robots" };
    case "Canonical":
      return v === "(missing)" || !String(v).trim()
        ? { status: "fail", hint: "Add a canonical URL" }
        : { status: "pass" };
    case "Canonical count": {
      const n = Number(v);
      if (n === 1) return { status: "pass" };
      if (n === 0) return { status: "fail", hint: "No canonical link" };
      return { status: "warn", hint: "Use a single canonical" };
    }
    case "Canonical valid":
      return v === "Yes" ? { status: "pass" } : { status: "fail", hint: "Should be absolute http(s)" };
    case "Canonical same host":
      return v === "Yes" ? { status: "pass" } : { status: "warn", hint: "Host differs from page" };
    case "Title":
      return v === "(missing)" || !String(v).trim()
        ? { status: "fail", hint: "Add a title tag" }
        : { status: "pass" };
    case "Description":
      return v === "(missing)" || !String(v).trim()
        ? { status: "fail", hint: "Add a meta description" }
        : { status: "pass" };
    case "Desc chars": {
      const n = Number(v);
      if (n === 0) return { status: "fail", hint: "Empty description" };
      if (n >= 70 && n <= 170) return { status: "pass", hint: "~70–170 is a common target" };
      if (n < 70) return { status: "warn", hint: "Often shows short in SERPs" };
      return { status: "warn", hint: "May truncate in search results" };
    }
    case "H1 count": {
      const n = Number(v);
      if (n === 1) return { status: "pass", hint: "One clear H1" };
      if (n === 0) return { status: "fail", hint: "Add one H1" };
      return { status: "warn", hint: "Multiple H1s—usually simplify to one" };
    }
    case "Robots": {
      const s = String(v);
      if (s === "(missing)") return { status: "pass", hint: "Default: indexable" };
      if (/\bnoindex\b/i.test(s)) return { status: "fail", hint: "noindex blocks indexing" };
      if (/\bnofollow\b/i.test(s)) return { status: "warn", hint: "nofollow on links" };
      return { status: "pass" };
    }
    case "tel links":
      return Array.isArray(v) && v.length > 0
        ? { status: "pass", hint: "Click-to-call present" }
        : { status: "warn", hint: "No tel: links found" };
    case "mailto links":
      return Array.isArray(v) && v.length > 0 ? { status: "pass" } : { status: "neutral", hint: "Optional" };
    default:
      return { status: "neutral" };
  }
}

function StatusBadge({ status }: { status: RowStatus }) {
  const styles: Record<RowStatus, { bg: string; text: string; label: string }> = {
    pass: { bg: "bg-emerald-50", text: "text-emerald-800 ring-emerald-200", label: "Good" },
    warn: { bg: "bg-amber-50", text: "text-amber-900 ring-amber-200", label: "Review" },
    fail: { bg: "bg-red-50", text: "text-red-800 ring-red-200", label: "Issue" },
    neutral: { bg: "bg-neutral-100", text: "text-neutral-600 ring-neutral-200", label: "—" },
  };
  const s = styles[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${s.bg} ${s.text}`}
    >
      {s.label}
    </span>
  );
}

function formatValue(key: keyof CoreAudit, data: CoreAudit): ReactNode {
  const v = data[key];
  if (key === "Canonical" && typeof v === "string" && v.startsWith("http")) {
    return (
      <a
        href={v}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all font-medium underline-offset-2 hover:underline"
        style={{ color: LINK }}
      >
        {v}
      </a>
    );
  }
  if (key === "Title" || key === "Description") {
    return <span className="text-base font-medium leading-snug">{String(v)}</span>;
  }
  if (key === "tel links" || key === "mailto links") {
    const arr = v as string[];
    if (!arr.length) {
      return <span className="text-neutral-500">(none)</span>;
    }
    return (
      <ul className="max-h-48 list-inside list-disc space-y-1 overflow-y-auto text-sm leading-snug">
        {arr.map((href) => (
          <li key={href} className="break-all">
            <a
              href={href}
              className="font-medium underline-offset-2 hover:underline"
              style={{ color: LINK }}
            >
              {href}
            </a>
          </li>
        ))}
      </ul>
    );
  }
  return <span className="tabular-nums">{String(v)}</span>;
}

/** PWMPros targets: mobile ≥75, desktop ≥85 on Lighthouse performance score */
const PS_MOBILE_GOOD = 75;
const PS_DESKTOP_GOOD = 85;

function PageSpeedStrategyCard({
  variant,
  r,
}: {
  variant: "mobile" | "desktop";
  r: PageSpeedStrategyResult;
}) {
  const threshold = variant === "mobile" ? PS_MOBILE_GOOD : PS_DESKTOP_GOOD;
  const label = variant === "mobile" ? "Mobile" : "Desktop";
  const score = r.performanceScore;
  const meetsTarget = score != null && score >= threshold;
  const pct = score != null ? Math.min(100, Math.max(0, score)) : 0;

  const fidNote =
    r.fidSource === "field" ? "CrUX p75" : r.fidSource === "lab" ? "Lab" : null;

  const metricRow = (name: string, val: string) => (
    <div className="flex items-baseline justify-between gap-3 border-t border-neutral-100/80 py-2.5 first:border-t-0 first:pt-0">
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{name}</span>
      <span className="text-right text-sm font-semibold tabular-nums" style={{ color: TEXT }}>
        {val}
      </span>
    </div>
  );

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border-2 shadow-md transition-colors ${
        meetsTarget
          ? "border-emerald-200 bg-gradient-to-b from-emerald-50/80 to-white"
          : "border-amber-200 bg-gradient-to-b from-amber-50/80 to-white"
      }`}
      style={{ color: TEXT }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-neutral-200/80 px-5 pb-4 pt-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">{label}</p>
          <p className="mt-1 text-xs text-neutral-600">
            Good score: <strong>≥{threshold}</strong>
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ring-2 ring-offset-2 ${
            meetsTarget
              ? "bg-emerald-600 text-white ring-emerald-600/30"
              : "bg-amber-500 text-white ring-amber-500/30"
          }`}
        >
          {meetsTarget ? "On target" : "Below target"}
        </span>
      </div>

      <div className="px-5 pb-2 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Performance</p>
        <div className="mt-2 flex items-end gap-3">
          <span className="text-5xl font-black tabular-nums leading-none tracking-tight" style={{ color: TEXT }}>
            {score ?? "—"}
          </span>
          {score != null ? (
            <span className="pb-1 text-lg font-medium text-neutral-400">/ 100</span>
          ) : null}
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-neutral-200/80">
          <div
            className={`h-full rounded-full transition-all ${meetsTarget ? "bg-emerald-500" : "bg-amber-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="px-5 pb-5">
        {metricRow("LCP", r.lcpDisplay ?? (r.lcpMs != null ? `${Math.round(r.lcpMs)} ms` : "—"))}
        {metricRow("CLS", r.clsDisplay ?? (r.cls != null ? String(r.cls) : "—"))}
        {metricRow(
          "FID",
          r.fidDisplay ??
            (r.fidMs != null ? `${Math.round(r.fidMs)} ms${fidNote ? ` (${fidNote})` : ""}` : "—"),
        )}
        {r.inpDisplay || r.inpMs != null
          ? metricRow("INP", r.inpDisplay ?? (r.inpMs != null ? `${Math.round(r.inpMs)} ms` : "—"))
          : null}
      </div>
    </div>
  );
}

function ConsoleCheckPanel({ data }: { data: ConsoleBundle }) {
  const httpLines = data.httpErrorResponses ?? [];

  const hasProblems =
    data.consoleErrors.length > 0 ||
    data.pageErrors.length > 0 ||
    data.requestFailures.length > 0 ||
    httpLines.length > 0;
  const hasWarningsOnly = !hasProblems && data.consoleWarnings.length > 0;

  const list = (title: string, items: string[], tone: "red" | "amber" | "neutral") => (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50/50 p-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">None</p>
      ) : (
        <ul className="max-h-48 list-inside list-disc space-y-1 overflow-y-auto text-sm leading-snug">
          {items.map((line, i) => (
            <li
              key={i}
              className={
                tone === "red"
                  ? "text-red-800"
                  : tone === "amber"
                    ? "text-amber-900"
                    : "text-neutral-800"
              }
            >
              <span className="break-words font-mono text-xs">{line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ring-2 ring-offset-2 ${
            hasProblems
              ? "bg-red-600 text-white ring-red-600/30"
              : hasWarningsOnly
                ? "bg-amber-500 text-white ring-amber-500/30"
                : "bg-emerald-600 text-white ring-emerald-600/30"
          }`}
        >
          {hasProblems ? "Issues found" : hasWarningsOnly ? "Warnings only" : "No errors"}
        </span>
        {data.navigationTimedOut ? (
          <span className="text-xs text-amber-800">Navigation timed out — results may be partial.</span>
        ) : null}
        {data.navigatedUrl ? (
          <span className="text-xs text-neutral-600">
            Final URL:{" "}
            <a href={data.navigatedUrl} target="_blank" rel="noopener noreferrer" style={{ color: LINK }}>
              {data.navigatedUrl}
            </a>
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {list("HTTP 4xx/5xx (which URL failed)", httpLines, "red")}
        {list("Console — error", data.consoleErrors, "red")}
        {list("Uncaught page errors", data.pageErrors, "red")}
        {list("Failed requests (network)", data.requestFailures, "amber")}
        {list("Console — warning", data.consoleWarnings, "amber")}
      </div>
      <p className="text-xs text-neutral-500">
        Headless Chromium (Playwright): <code className="rounded bg-neutral-100 px-1">load</code> + 2s settle.
        Generic Chrome lines like “Failed to load resource … status 403 ()” are omitted when that status is already
        listed above with the URL. Compare with DevTools → Network in your own browser.
      </p>
    </div>
  );
}

function ConsoleSkeleton() {
  return (
    <div className="animate-pulse space-y-3 rounded-xl border border-neutral-200 bg-neutral-100/80 p-5">
      <div className="h-6 w-40 rounded bg-neutral-300" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="h-24 rounded bg-neutral-200" />
        <div className="h-24 rounded bg-neutral-200" />
      </div>
    </div>
  );
}

function PageSpeedSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {["Mobile", "Desktop"].map((name) => (
        <div
          key={name}
          className="animate-pulse rounded-2xl border border-neutral-200 bg-neutral-100/80 p-5"
        >
          <div className="h-4 w-24 rounded bg-neutral-300" />
          <div className="mt-4 h-12 w-28 rounded bg-neutral-300" />
          <div className="mt-4 h-2 w-full rounded bg-neutral-300" />
          <div className="mt-6 space-y-2">
            <div className="h-3 w-full rounded bg-neutral-200" />
            <div className="h-3 w-full rounded bg-neutral-200" />
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditGrid({ data }: { data: CoreAudit }) {
  const summary = useMemo(() => {
    let pass = 0,
      warn = 0,
      fail = 0;
    for (const key of ROW_ORDER) {
      const { status } = assessRow(key, data);
      if (status === "pass") pass++;
      else if (status === "warn") warn++;
      else if (status === "fail") fail++;
    }
    return { pass, warn, fail, total: ROW_ORDER.length };
  }, [data]);

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm shadow-sm"
        style={{ color: TEXT }}
      >
        <span className="font-medium opacity-80">Summary:</span>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-emerald-800 ring-1 ring-emerald-200">
          Good {summary.pass}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-amber-900 ring-1 ring-amber-200">
          Review {summary.warn}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-red-800 ring-1 ring-red-200">
          Issue {summary.fail}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ROW_ORDER.map((key) => {
          const { status, hint } = assessRow(key, data);
          const label = LABEL_PRETTY[key] ?? key;
          return (
            <div
              key={key}
              className="flex flex-col rounded-xl border border-neutral-200 bg-white p-4 shadow-sm ring-1 ring-black/[0.03]"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT, opacity: 0.7 }}>
                  {label}
                </h3>
                <StatusBadge status={status} />
              </div>
              <div className="min-h-[2.5rem] flex-1 text-sm leading-relaxed" style={{ color: TEXT }}>
                {formatValue(key, data)}
              </div>
              {hint ? (
                <p className="mt-2 border-t border-neutral-100 pt-2 text-xs leading-snug text-neutral-500">{hint}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SchemaCheckPanel({ s }: { s: SchemaCheckResult }) {
  const flag = (label: string, on: boolean) => (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ${
        on ? "bg-emerald-50 text-emerald-900 ring-emerald-200" : "bg-neutral-100 text-neutral-500 ring-neutral-200"
      }`}
    >
      {label}: {on ? "yes" : "no"}
    </span>
  );

  /** Optional page-level types — absence is normal, not a failure. */
  const flagOptional = (label: string, on: boolean) => (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ${
        on
          ? "bg-emerald-50 text-emerald-900 ring-emerald-200"
          : "bg-slate-100 text-slate-700 ring-slate-200"
      }`}
    >
      {label}: {on ? "present" : "not present (optional)"}
    </span>
  );

  return (
    <div className="space-y-4" style={{ color: TEXT }}>
      <div className="flex flex-wrap gap-2">
        {flag("Organization", s.hasOrganization)}
        {flag("LocalBusiness", s.hasLocalBusiness)}
        {flag("WebSite", s.hasWebSite)}
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Optional @types</p>
        <p className="mt-1 text-xs text-neutral-600">
          Many pages omit these (e.g. FAQPage only where there is FAQ content). Not having them is not a parse error.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {flagOptional("FAQPage", s.hasFaqPage)}
          {flagOptional("BreadcrumbList", s.hasBreadcrumbList)}
          {flagOptional("Product", s.hasProduct)}
        </div>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">JSON-LD</p>
          <p className="mt-1 tabular-nums">
            Blocks: <strong>{s.jsonLdBlockCount}</strong>
            {" · "}
            Invalid JSON in blocks:{" "}
            <strong className={s.jsonLdParseErrors > 0 ? "text-amber-800" : ""}>{s.jsonLdParseErrors}</strong>
          </p>
          <p className="mt-1.5 text-xs leading-snug text-neutral-600">
            “Invalid JSON” only counts <code className="rounded bg-neutral-100 px-1">ld+json</code> scripts that are not
            valid JSON. Missing FAQ or other schema types does not increase this count.
          </p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Open Graph</p>
          <p className="mt-1 line-clamp-2 text-neutral-700">
            <span className="text-neutral-500">og:title</span> {s.ogTitle ?? "—"}
          </p>
          <p className="mt-0.5 line-clamp-2 text-neutral-700">
            <span className="text-neutral-500">og:type</span> {s.ogType ?? "—"}
          </p>
        </div>
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">@types (distinct)</p>
        {s.typesUnique.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-600">No JSON-LD @type values found.</p>
        ) : (
          <ul className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto text-xs">
            {s.typesUnique.map((t) => (
              <li
                key={t}
                className="rounded-md bg-white px-2 py-1 font-mono ring-1 ring-neutral-200"
              >
                {t}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ImageAltTable({ rows }: { rows: ImageAltRow[] }) {
  const bad = rows.filter((r) => r.status !== "present").length;
  return (
    <div className="space-y-2">
      <p className="text-sm text-neutral-600">
        <strong className="tabular-nums">{rows.length}</strong> images
        {bad > 0 ? (
          <>
            {" "}
            · <span className="text-amber-900">{bad} missing or empty alt</span>
          </>
        ) : (
          " · all have non-empty alt"
        )}
      </p>
      <div className="max-h-80 overflow-auto rounded-xl border border-neutral-200">
        <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-neutral-100/95 text-xs font-semibold uppercase tracking-wide text-neutral-600">
            <tr>
              <th className="border-b border-neutral-200 px-3 py-2">Alt</th>
              <th className="border-b border-neutral-200 px-3 py-2">src</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.src}-${i}`}
                className={r.status !== "present" ? "bg-amber-50/80" : "bg-white"}
              >
                <td className="border-b border-neutral-100 px-3 py-2 align-top font-medium">
                  <span
                    className={
                      r.status === "present" ? "text-neutral-800" : "text-amber-900"
                    }
                  >
                    {r.alt}
                  </span>
                </td>
                <td className="border-b border-neutral-100 px-3 py-2 align-top">
                  {r.src.startsWith("http") ? (
                    <a
                      href={r.src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all font-mono text-xs underline-offset-2 hover:underline"
                      style={{ color: LINK }}
                    >
                      {r.src}
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-neutral-600">{r.src}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LegalPagesPanel({ legal }: { legal: AuditResponse["legalPages"] }) {
  const block = (title: string, items: LegalLinkVerified[]) => (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50/40 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600">No matching links found on the page.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((c) => (
            <li key={c.href} className="border-b border-neutral-200/80 pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${
                    c.reachable
                      ? "bg-emerald-50 text-emerald-900 ring-emerald-200"
                      : "bg-red-50 text-red-900 ring-red-200"
                  }`}
                >
                  {c.httpStatus != null ? `HTTP ${c.httpStatus}` : "No response"}
                </span>
                {c.reachable ? (
                  <span className="text-xs text-emerald-800">Reachable</span>
                ) : (
                  <span className="text-xs text-red-800">{c.note ?? "Unreachable"}</span>
                )}
              </div>
              <p className="mt-1 text-xs text-neutral-500">Anchor: {c.anchorText}</p>
              <p className="mt-1 break-all text-sm">
                <a
                  href={c.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:underline"
                  style={{ color: LINK }}
                >
                  {c.href}
                </a>
              </p>
              {c.finalUrlChecked !== c.href ? (
                <p className="mt-1 break-all text-xs text-neutral-500">
                  Final: {c.finalUrlChecked}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {block("Privacy policy candidates", legal.privacy)}
      {block("Terms / legal candidates", legal.terms)}
    </div>
  );
}

export function AuditApp() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const [psLoading, setPsLoading] = useState(false);
  const [psData, setPsData] = useState<PageSpeedBundle | null>(null);
  const [psErr, setPsErr] = useState<string | null>(null);
  const [psCopied, setPsCopied] = useState(false);

  const [consoleLoading, setConsoleLoading] = useState(false);
  const [consoleData, setConsoleData] = useState<ConsoleBundle | null>(null);
  const [consoleErr, setConsoleErr] = useState<string | null>(null);
  const [consoleCopied, setConsoleCopied] = useState(false);

  const run = useCallback(() => {
    if (!url.trim()) return;
    setErr(null);
    setPsErr(null);
    setConsoleErr(null);
    setData(null);
    setPsData(null);
    setConsoleData(null);
    setLoading(true);
    setPsLoading(true);
    setConsoleLoading(true);

    fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setErr(json.error || "Request failed");
          return;
        }
        setData(json as AuditResponse);
      })
      .catch(() => setErr("Network error. Try again."))
      .finally(() => setLoading(false));

    fetch("/api/pagespeed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setPsErr(json.error || "PageSpeed request failed");
          return;
        }
        setPsData(json as PageSpeedBundle);
      })
      .catch(() => setPsErr("Network error. Try again."))
      .finally(() => setPsLoading(false));

    fetch("/api/console-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setConsoleErr(json.error || "Console check failed");
          return;
        }
        setConsoleData(json as ConsoleBundle);
      })
      .catch(() => setConsoleErr("Network error. Try again."))
      .finally(() => setConsoleLoading(false));
  }, [url]);

  const copyMd = useCallback(async () => {
    if (!data?.markdown) return;
    try {
      await navigator.clipboard.writeText(data.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr("Could not copy to clipboard.");
    }
  }, [data?.markdown]);

  const retryPageSpeed = useCallback(() => {
    if (!url.trim()) return;
    setPsErr(null);
    setPsData(null);
    setPsLoading(true);
    fetch("/api/pagespeed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setPsErr(json.error || "PageSpeed request failed");
          return;
        }
        setPsData(json as PageSpeedBundle);
      })
      .catch(() => setPsErr("Network error. Try again."))
      .finally(() => setPsLoading(false));
  }, [url]);

  const retryConsole = useCallback(() => {
    if (!url.trim()) return;
    setConsoleErr(null);
    setConsoleData(null);
    setConsoleLoading(true);
    fetch("/api/console-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setConsoleErr(json.error || "Console check failed");
          return;
        }
        setConsoleData(json as ConsoleBundle);
      })
      .catch(() => setConsoleErr("Network error. Try again."))
      .finally(() => setConsoleLoading(false));
  }, [url]);

  const copyPsMd = useCallback(async () => {
    if (!psData?.markdown) return;
    try {
      await navigator.clipboard.writeText(psData.markdown);
      setPsCopied(true);
      setTimeout(() => setPsCopied(false), 2000);
    } catch {
      setPsErr("Could not copy to clipboard.");
    }
  }, [psData?.markdown]);

  const copyConsoleMd = useCallback(async () => {
    if (!consoleData?.markdown) return;
    try {
      await navigator.clipboard.writeText(consoleData.markdown);
      setConsoleCopied(true);
      setTimeout(() => setConsoleCopied(false), 2000);
    } catch {
      setConsoleErr("Could not copy to clipboard.");
    }
  }, [consoleData?.markdown]);

  return (
    <div className="relative min-h-full" style={{ backgroundColor: "#f7f5f0", color: TEXT }}>
      <div className="relative mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 py-12 sm:px-8 lg:px-12">
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: TEXT }}>
            PWMPros Site technical audit
          </h1>
        </header>

        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <label className="block">
            <span className="mb-2 block text-sm font-medium" style={{ color: TEXT }}>
              Page URL
            </span>
            <input
              type="url"
              placeholder="https://example.com/"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-[#f7f5f0] px-4 py-3 text-base outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-300/60"
              style={{ color: TEXT }}
            />
          </label>
          <div className="mt-4">
            <button
              type="button"
              onClick={run}
              disabled={loading || psLoading || consoleLoading || !url.trim()}
              className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: BTN }}
            >
              {loading || psLoading || consoleLoading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Running…
                </span>
              ) : (
                "Run audit"
              )}
            </button>
            <p className="mt-2 text-xs text-neutral-600">
              Runs <strong>on-page audit</strong>, <strong>PageSpeed</strong> (mobile + desktop), and a{" "}
              <strong>headless browser console</strong> check (Playwright) together.
            </p>
          </div>
        </div>

        {err ? (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            role="alert"
          >
            {err}
          </div>
        ) : null}

        {data ? (
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider" style={{ color: TEXT, opacity: 0.55 }}>
                Fetched URL
              </p>
              <a
                href={data.finalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 break-all text-base underline-offset-2 hover:underline"
                style={{ color: LINK }}
              >
                {data.finalUrl}
              </a>
            </div>

            <div>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold" style={{ color: TEXT }}>
                    On-page audit
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                    Core indexation, canonical, primary meta, H1, robots, and contact links. Privacy/terms, PageSpeed,
                    console, then schema and image alt follow below.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copyMd}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium shadow-sm transition hover:bg-neutral-50"
                  style={{ color: TEXT }}
                >
                  {copied ? "Copied" : "Copy markdown"}
                </button>
              </div>
              <AuditGrid data={data.coreAudit} />
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-xl font-semibold" style={{ color: TEXT }}>
                Privacy &amp; terms (link check)
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                Finds likely privacy and terms URLs from link hrefs and anchor text, then requests each candidate
                (HEAD, GET fallback) to verify reachability. Not a legal review — only technical discovery + HTTP
                status.
              </p>
              <div className="mt-5">
                <LegalPagesPanel legal={data.legalPages} />
              </div>
            </div>
          </div>
        ) : null}

        {(data || psData || psLoading || psErr) && (
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold" style={{ color: TEXT }}>
                  PageSpeed Insights
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                  Lighthouse performance score vs targets: <strong>mobile ≥{PS_MOBILE_GOOD}</strong>,{" "}
                  <strong>desktop ≥{PS_DESKTOP_GOOD}</strong>. LCP, CLS, FID, and INP when available.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {psData || psErr ? (
                  <button
                    type="button"
                    onClick={retryPageSpeed}
                    disabled={psLoading || !url.trim()}
                    className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium shadow-sm transition hover:bg-neutral-50 disabled:opacity-50"
                    style={{ color: TEXT }}
                  >
                    {psLoading ? "…" : "Retry PageSpeed"}
                  </button>
                ) : null}
                {psData ? (
                  <button
                    type="button"
                    onClick={copyPsMd}
                    className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium shadow-sm transition hover:bg-neutral-50"
                    style={{ color: TEXT }}
                  >
                    {psCopied ? "Copied" : "Copy PageSpeed markdown"}
                  </button>
                ) : null}
              </div>
            </div>
            {psErr ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                {psErr}
              </div>
            ) : null}
            {psLoading && !psData ? <PageSpeedSkeleton /> : null}
            {psData ? (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <PageSpeedStrategyCard variant="mobile" r={psData.mobile} />
                <PageSpeedStrategyCard variant="desktop" r={psData.desktop} />
              </div>
            ) : null}
          </div>
        )}

        {(consoleData || consoleLoading || consoleErr) && (
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold" style={{ color: TEXT }}>
                  Browser console
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                  Captures <strong>console.error</strong>, <strong>console.warn</strong>, uncaught page errors, and
                  failed network requests in headless Chromium (local server). NitroPack (
                  <code className="rounded bg-neutral-100 px-1 text-xs">*nitropack*</code>) HTTP noise is excluded.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {consoleData || consoleErr ? (
                  <button
                    type="button"
                    onClick={retryConsole}
                    disabled={consoleLoading || !url.trim()}
                    className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium shadow-sm transition hover:bg-neutral-50 disabled:opacity-50"
                    style={{ color: TEXT }}
                  >
                    {consoleLoading ? "…" : "Retry console check"}
                  </button>
                ) : null}
                {consoleData ? (
                  <button
                    type="button"
                    onClick={copyConsoleMd}
                    className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium shadow-sm transition hover:bg-neutral-50"
                    style={{ color: TEXT }}
                  >
                    {consoleCopied ? "Copied" : "Copy console markdown"}
                  </button>
                ) : null}
              </div>
            </div>
            {consoleErr ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                {consoleErr}
              </div>
            ) : null}
            {consoleLoading && !consoleData ? <ConsoleSkeleton /> : null}
            {consoleData ? <ConsoleCheckPanel data={consoleData} /> : null}
          </div>
        )}

        {data ? (
          <>
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-xl font-semibold" style={{ color: TEXT }}>
                Schema (JSON-LD)
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                Parses <code className="rounded bg-neutral-100 px-1 text-xs">application/ld+json</code> blocks and
                lists distinct <code className="rounded bg-neutral-100 px-1 text-xs">@type</code> values; flags common
                business/SEO types. Open Graph meta is shown for quick social preview context.
              </p>
              <div className="mt-5">
                <SchemaCheckPanel s={data.schemaCheck} />
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-xl font-semibold" style={{ color: TEXT }}>
                Image alt text
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                Every <code className="rounded bg-neutral-100 px-1 text-xs">&lt;img&gt;</code> on the fetched HTML with
                resolved <code className="rounded bg-neutral-100 px-1 text-xs">src</code> and alt status.
              </p>
              <div className="mt-5">
                <ImageAltTable rows={data.imageAltList} />
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
