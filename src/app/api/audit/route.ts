import { NextResponse } from "next/server";
import { parseAuditExtras, verifyLegalCandidates } from "@/lib/audit-extras";
import { runAudit, type AuditConfig } from "@/lib/audit";

export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SiteAuditBot/1.0; +https://vercel.com) AppleWebKit/537.36 (KHTML, like Gecko)";

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

export async function POST(req: Request) {
  let body: {
    url?: string;
    targetKeyword?: string;
    businessName?: string;
    phone?: string;
    addressOrServiceArea?: string;
    locationTerm?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const target = normalizeInputUrl(body.url ?? "");
  if (!target) {
    return NextResponse.json(
      { error: "Enter a valid URL (e.g. https://example.com/page)" },
      { status: 400 },
    );
  }

  const cfg: AuditConfig = {
    targetKeyword: (body.targetKeyword ?? "").trim(),
    businessName: (body.businessName ?? "").trim(),
    phone: (body.phone ?? "").trim(),
    addressOrServiceArea: (body.addressOrServiceArea ?? "").trim(),
    locationTerm: (body.locationTerm ?? "").trim(),
  };

  let res: Response;
  try {
    res = await fetch(target, {
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fetch failed";
    return NextResponse.json(
      {
        error: `Could not fetch URL: ${msg}. The site may block automated requests, require a browser, or be unreachable.`,
      },
      { status: 502 },
    );
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: `HTTP ${res.status} ${res.statusText} when fetching the page.` },
      { status: 502 },
    );
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
    return NextResponse.json(
      { error: "URL did not return HTML. Use a page URL that serves HTML." },
      { status: 400 },
    );
  }

  const html = await res.text();
  const finalUrl = res.url || target;

  try {
    const result = runAudit(html, target, finalUrl, cfg);
    const extras = parseAuditExtras(html, finalUrl);
    const legalPages = await verifyLegalCandidates(extras.legalCandidates);
    return NextResponse.json({
      url: result.url,
      finalUrl: result.finalUrl,
      coreAudit: result.coreAudit,
      markdown: result.markdown,
      schemaCheck: extras.schema,
      imageAltList: extras.imageAltList,
      legalPages,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Audit failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
