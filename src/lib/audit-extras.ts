import { load } from "cheerio";

const norm = (s: unknown) => (s ?? "").toString().replace(/\s+/g, " ").trim();
const lc = (s: string) => norm(s).toLowerCase();

function safeURL(u: string, base: string): URL | null {
  try {
    return new URL(u, base);
  } catch {
    return null;
  }
}

function toAbs(u: string, base: string) {
  return safeURL(u, base)?.href || "";
}

export type SchemaCheckResult = {
  jsonLdBlockCount: number;
  jsonLdParseErrors: number;
  /** Distinct @type values found in JSON-LD */
  typesUnique: string[];
  hasOrganization: boolean;
  hasLocalBusiness: boolean;
  hasWebSite: boolean;
  hasFaqPage: boolean;
  hasBreadcrumbList: boolean;
  hasProduct: boolean;
  /** Open Graph (optional social/meta) */
  ogTitle: string | null;
  ogDescription: string | null;
  ogType: string | null;
};

export type ImageAltRow = {
  src: string;
  /** Human-readable alt state */
  alt: string;
  status: "missing" | "empty" | "present";
};

export type LegalLinkCandidate = {
  kind: "privacy" | "terms";
  href: string;
  anchorText: string;
};

export type LegalLinkVerified = LegalLinkCandidate & {
  finalUrlChecked: string;
  httpStatus: number | null;
  reachable: boolean;
  note?: string;
};

function collectJsonLdTypes(obj: unknown, out: string[]): void {
  if (!obj) return;
  if (Array.isArray(obj)) return obj.forEach((x) => collectJsonLdTypes(x, out));
  if (typeof obj === "object" && obj !== null) {
    const o = obj as Record<string, unknown>;
    if (o["@type"] !== undefined) {
      const t = o["@type"];
      if (Array.isArray(t)) t.forEach((x) => out.push(String(x)));
      else out.push(String(t));
    }
    for (const k of Object.keys(o)) collectJsonLdTypes(o[k], out);
  }
}

const PRIVACY_PATH =
  /\/(privacy|privacy-policy|privacypolicy|privacy-notice|gdpr|data-protection)(\/|$|\?|#)/i;
const TERMS_PATH =
  /\/(terms|terms-of-service|terms-and-conditions|terms-of-use|legal|tos|terms-conditions)(\/|$|\?|#)/i;

function looksPrivacyHref(pathname: string, full: string): boolean {
  if (PRIVACY_PATH.test(pathname) || PRIVACY_PATH.test(full)) return true;
  return /privacy/i.test(pathname) && !/cookie/i.test(pathname);
}

function looksTermsHref(pathname: string, full: string): boolean {
  if (TERMS_PATH.test(pathname) || TERMS_PATH.test(full)) return true;
  return /\bterms\b/i.test(pathname) && /service|use|condition|legal/i.test(pathname + full);
}

function looksPrivacyText(text: string): boolean {
  const t = lc(text);
  if (/cookie/.test(t)) return false;
  return /\bprivacy policy\b|\bprivacy\b/.test(t);
}

function looksTermsText(text: string): boolean {
  const t = lc(text);
  return /\bterms of (service|use)\b|\bterms (&|and) conditions\b|\bterms\b/.test(t);
}

export function parseAuditExtras(html: string, finalUrl: string) {
  const $ = load(html);

  const jsonLdScripts = $('script[type="application/ld+json"]');
  const jsonLdTypes: string[] = [];
  let jsonLdParseErrors = 0;

  jsonLdScripts.each((_, s) => {
    const el = $(s);
    const raw = (el.text() || el.html() || "").trim();
    try {
      const data = JSON.parse(raw || "null");
      collectJsonLdTypes(data, jsonLdTypes);
    } catch {
      jsonLdParseErrors++;
    }
  });

  const typesUnique = [...new Set(jsonLdTypes.map(String))];
  const typesLc = typesUnique.map((t) => lc(t));

  const hasType = (needle: RegExp) => typesLc.some((t) => needle.test(t));

  const schema: SchemaCheckResult = {
    jsonLdBlockCount: jsonLdScripts.length,
    jsonLdParseErrors,
    typesUnique: typesUnique.slice(0, 40),
    hasOrganization: hasType(/organization/),
    hasLocalBusiness: hasType(/localbusiness|local business/),
    hasWebSite: hasType(/website|webpage/),
    hasFaqPage: hasType(/faqpage|faq/),
    hasBreadcrumbList: hasType(/breadcrumb/),
    hasProduct: hasType(/product/),
    ogTitle: norm($('meta[property="og:title"]').attr("content") || "") || null,
    ogDescription: norm($('meta[property="og:description"]').attr("content") || "") || null,
    ogType: norm($('meta[property="og:type"]').attr("content") || "") || null,
  };

  const imageAltList: ImageAltRow[] = [];
  $("img").each((_, img) => {
    const $img = $(img);
    const src = toAbs($img.attr("src") || "", finalUrl);
    const altAttr = $img.attr("alt");
    let status: ImageAltRow["status"];
    let alt: string;
    if (altAttr === undefined) {
      status = "missing";
      alt = "(missing)";
    } else if (norm(altAttr) === "") {
      status = "empty";
      alt = "(empty)";
    } else {
      status = "present";
      alt = norm(altAttr);
    }
    imageAltList.push({ src: src || "(no src)", alt, status });
  });

  const privacySeen = new Set<string>();
  const termsSeen = new Set<string>();
  const privacy: LegalLinkCandidate[] = [];
  const terms: LegalLinkCandidate[] = [];

  $("a[href]").each((_, a) => {
    const $a = $(a);
    const raw = norm($a.attr("href") || "");
    if (!raw || raw.startsWith("javascript:") || raw.startsWith("#")) return;
    const abs = toAbs(raw, finalUrl);
    if (!abs || !/^https?:/i.test(abs)) return;

    let u: URL;
    try {
      u = new URL(abs);
    } catch {
      return;
    }
    const pathname = u.pathname;
    const text = norm($a.text());

    if (!privacySeen.has(abs) && (looksPrivacyHref(pathname, abs) || looksPrivacyText(text))) {
      privacySeen.add(abs);
      privacy.push({ kind: "privacy", href: abs, anchorText: text || "(no text)" });
    }
    if (!termsSeen.has(abs) && (looksTermsHref(pathname, abs) || looksTermsText(text))) {
      termsSeen.add(abs);
      terms.push({ kind: "terms", href: abs, anchorText: text || "(no text)" });
    }
  });

  const cap = (arr: LegalLinkCandidate[], n: number) => arr.slice(0, n);

  return {
    schema,
    imageAltList,
    legalCandidates: {
      privacy: cap(privacy, 6),
      terms: cap(terms, 6),
    },
  };
}

const UA =
  "Mozilla/5.0 (compatible; SiteAuditBot/1.0; +https://vercel.com) AppleWebKit/537.36 (KHTML, like Gecko)";

export async function verifyLegalUrl(
  href: string,
): Promise<{ finalUrl: string; httpStatus: number | null; reachable: boolean; note?: string }> {
  try {
    let res = await fetch(href, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 405 || res.status === 501 || res.status === 403) {
      res = await fetch(href, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(15_000),
      });
    }
    const finalUrl = res.url || href;
    return {
      finalUrl,
      httpStatus: res.status,
      reachable: res.ok,
      note: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return { finalUrl: href, httpStatus: null, reachable: false, note: msg };
  }
}

export async function verifyLegalCandidates(candidates: {
  privacy: LegalLinkCandidate[];
  terms: LegalLinkCandidate[];
}): Promise<{ privacy: LegalLinkVerified[]; terms: LegalLinkVerified[] }> {
  const map = async (c: LegalLinkCandidate): Promise<LegalLinkVerified> => {
    const v = await verifyLegalUrl(c.href);
    return {
      ...c,
      finalUrlChecked: v.finalUrl,
      httpStatus: v.httpStatus,
      reachable: v.reachable,
      note: v.note,
    };
  };
  const [privacy, terms] = await Promise.all([
    Promise.all(candidates.privacy.map(map)),
    Promise.all(candidates.terms.map(map)),
  ]);
  return { privacy, terms };
}
