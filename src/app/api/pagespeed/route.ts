import { NextResponse } from "next/server";
import { parsePageSpeedResponse, type PageSpeedStrategyResult } from "@/lib/pagespeed";

/** PSI often needs 60–120s. Raise in Vercel dashboard if your plan caps below this. */
export const maxDuration = 120;

const PSI_BASE = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

function normalizeInputUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function toMarkdown(url: string, mobile: PageSpeedStrategyResult, desktop: PageSpeedStrategyResult) {
  const block = (label: string, r: PageSpeedStrategyResult) =>
    [
      `### ${label}`,
      `- **Performance score:** ${r.performanceScore ?? "—"}`,
      `- **LCP:** ${r.lcpDisplay ?? (r.lcpMs != null ? `${Math.round(r.lcpMs)} ms` : "—")}`,
      `- **CLS:** ${r.clsDisplay ?? (r.cls != null ? String(r.cls) : "—")}`,
      `- **FID:** ${r.fidDisplay ?? (r.fidMs != null ? `${Math.round(r.fidMs)} ms` : "—")}${r.fidSource !== "none" ? ` _(${r.fidSource})_` : ""}`,
      r.inpDisplay || r.inpMs != null
        ? `- **INP:** ${r.inpDisplay ?? (r.inpMs != null ? `${Math.round(r.inpMs)} ms` : "—")} _(Core Web Vitals interactivity)_`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

  return ["# PageSpeed Insights", `**URL:** ${url}`, "", block("Mobile", mobile), "", block("Desktop", desktop)].join(
    "\n",
  );
}

export async function POST(req: Request) {
  const key = process.env.GOOGLE_PAGESPEED_API_KEY;
  if (!key?.trim()) {
    return NextResponse.json(
      {
        error:
          "PageSpeed is not configured. Set GOOGLE_PAGESPEED_API_KEY in your environment (Google Cloud API key with PageSpeed Insights API enabled).",
      },
      { status: 503 },
    );
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const target = normalizeInputUrl(body.url ?? "");
  if (!target) {
    return NextResponse.json({ error: "Enter a valid URL" }, { status: 400 });
  }

  const run = async (strategy: "mobile" | "desktop") => {
    const u = new URL(PSI_BASE);
    u.searchParams.set("url", target);
    u.searchParams.set("key", key);
    u.searchParams.set("strategy", strategy);
    u.searchParams.set("category", "performance");
    const res = await fetch(u.toString(), {
      // PSI can exceed 60s on heavy URLs; keep below maxDuration with headroom
      signal: AbortSignal.timeout(110_000),
    });
    const json: unknown = await res.json().catch(() => null);
    const apiErr = json as { error?: { message?: string } } | null;
    if (!res.ok) {
      const msg = apiErr?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    if (apiErr?.error?.message) {
      throw new Error(apiErr.error.message);
    }
    return parsePageSpeedResponse(json, strategy);
  };

  try {
    const [mobile, desktop] = await Promise.all([run("mobile"), run("desktop")]);
    const markdown = toMarkdown(target, mobile, desktop);
    return NextResponse.json({
      url: target,
      mobile,
      desktop,
      markdown,
    });
  } catch (e) {
    let msg = e instanceof Error ? e.message : "PageSpeed request failed";
    if (/aborted|timeout/i.test(msg)) {
      msg =
        "Request timed out before Google finished. PSI often needs 60–90s per strategy; try again. On Vercel, raise the function max duration (Project Settings → Functions) if your plan allows.";
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
