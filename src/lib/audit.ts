import { load } from "cheerio";

export type AuditConfig = {
  targetKeyword: string;
  businessName: string;
  phone: string;
  addressOrServiceArea: string;
  locationTerm: string;
};

export type Issue = {
  Severity: "High" | "Med" | "Low";
  Area: string;
  Issue: string;
  Fix: string;
  route?: string;
};

export type Check = {
  Category: string;
  Check: string;
  Status: "✅ Pass" | "❌ Flag";
  Notes: string;
};

/** Minimal on-page rows for the UI (indexation, canonical, meta, contact links). */
export type CoreAudit = {
  Indexable: string;
  Followable: string;
  Canonical: string;
  "Canonical count": number;
  "Canonical valid": string;
  "Canonical same host": string;
  Title: string;
  Description: string;
  "Desc chars": number;
  /** Single H1 is a standard on-page check */
  "H1 count": number;
  Robots: string;
  /** Distinct `href` values (normalized trim) for `tel:` links */
  "tel links": string[];
  /** Distinct `href` values for `mailto:` links */
  "mailto links": string[];
};

export type AuditResult = {
  url: string;
  finalUrl: string;
  cfg: AuditConfig;
  /** Primary summary for clients that only need core meta + technical signals */
  coreAudit: CoreAudit;
  meta: Record<string, string | number | boolean>;
  headingRows: Array<{ Level: string; Count: number; Samples: string }>;
  linkTable: Record<string, number>;
  repeatedAnchorTexts: Array<{ anchorText: string; count: number }>;
  httpLinkSamples: Array<{ href: string; text: string }>;
  imageTable: Record<string, number>;
  missingAltSamples: Array<{ src: string; alt: string; isIcon: boolean }>;
  iconKeywordAltSamples: Array<{ src: string; alt: string }>;
  schemaTable: Record<string, string | number>;
  nap: Record<string, boolean | null>;
  phoneTable: Record<string, number>;
  phonesFound: Array<{
    digits: string;
    source: string;
    raw: string;
    displayText: string;
  }>;
  mapTable: Record<string, number>;
  checks: Check[];
  issues: Issue[];
  markdown: string;
  snapshot: {
    indexable: boolean;
    followable: boolean;
    canonical: string;
    h1Count: number;
    internal: number;
    external: number;
    httpLinks: number;
    imgs: number;
    missingAlt: number;
    phonesFound: number;
    expectedPhonePresent: boolean | null;
    jsonLdBlocks: number;
    hasFAQSchema: boolean;
  };
};

const norm = (s: unknown) => (s ?? "").toString().replace(/\s+/g, " ").trim();
const lc = (s: string) => norm(s).toLowerCase();
const uniq = <T>(arr: T[]) => [...new Set(arr)];

function estimatePx(text: string) {
  const t = norm(text);
  let px = 0;
  for (const ch of t) {
    if ("WMW@#%&".includes(ch)) px += 9;
    else if ("ilI1|".includes(ch)) px += 4;
    else if (" .,;:'\"!()[]".includes(ch)) px += 3;
    else px += 7;
  }
  return Math.round(px);
}

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

function sameHost(u: string, pageHost: string) {
  return safeURL(u, "https://" + pageHost)?.hostname === pageHost;
}

function isHttpUrl(u: string, base: string) {
  const x = safeURL(u, base);
  return !!x && (x.protocol === "http:" || x.protocol === "https:");
}

function includesLoose(haystack: string, needle: string) {
  if (!needle) return false;
  return lc(haystack).includes(lc(needle));
}

const digitsOnly = (s: string) => (s || "").replace(/[^\d]/g, "");

function phoneMatches(text: string, phone: string) {
  if (!phone) return false;
  const t = digitsOnly(lc(text));
  const p = digitsOnly(lc(phone));
  return p.length >= 7 && t.includes(p);
}

const phoneRegex =
  /(?:\+?1[\s.-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

const severityRank: Record<string, number> = { High: 0, Med: 1, Low: 2 };

function routeIssue(iss: Issue): string {
  const seoTeamKeywords = [
    "duplicate content",
    "metadata",
    "schema",
    "internal links",
    "keyword",
    "nap",
    "canonical",
    "noindex",
    "nofollow",
    "phone",
  ];
  const webTeamKeywords = [
    "layout",
    "broken images",
    "media",
    "plugin",
    "map",
    "navigation",
    "padding",
    "margins",
    "button",
  ];
  const s = lc(`${iss.Area} ${iss.Issue}`);
  const seo = seoTeamKeywords.some((k) => s.includes(lc(k)));
  const web = webTeamKeywords.some((k) => s.includes(lc(k)));
  if (web && !seo) return "Web Team";
  if (seo && !web) return "SEO Team";
  return "SEO/Web (confirm)";
}

export function runAudit(
  html: string,
  pageUrl: string,
  finalUrl: string,
  cfg: AuditConfig,
): AuditResult {
  const $ = load(html);
  const pageHost = new URL(finalUrl).hostname;

  const title = norm($("title").first().text());
  const metaDescEl = $('meta[name="description"]');
  const metaDescription = norm(metaDescEl.attr("content") || "");
  const viewport = norm($('meta[name="viewport"]').attr("content") || "");
  const lang = norm($("html").attr("lang") || "");
  const canonicalTags = $('link[rel="canonical"]');
  const canonical = toAbs(canonicalTags.first().attr("href") || "", finalUrl);
  const robots = norm($('meta[name="robots"]').attr("content") || "");
  const googlebot = norm($('meta[name="googlebot"]').attr("content") || "");

  const robotsCombined = norm([robots, googlebot].filter(Boolean).join(", "));
  const noindex = /noindex/i.test(robotsCombined);
  const nofollow = /nofollow/i.test(robotsCombined);
  const indexable = robotsCombined ? !noindex : true;
  const followable = robotsCombined ? !nofollow : true;

  const page = {
    url: finalUrl,
    host: pageHost,
    title,
    titleChars: title.length,
    titlePx: title ? estimatePx(title) : 0,
    metaDescription,
    descChars: metaDescription.length,
    descPx: metaDescription ? estimatePx(metaDescription) : 0,
    viewport,
    lang,
    canonical,
    canonicalCount: canonicalTags.length,
    robots: robotsCombined,
  };

  const meta: Record<string, string | number | boolean> = {
    Indexable: indexable,
    Followable: followable,
    Canonical: page.canonical || "(missing)",
    "Canonical count": page.canonicalCount,
    "Canonical valid": !!page.canonical && isHttpUrl(page.canonical, finalUrl),
    "Canonical same host": !!page.canonical && sameHost(page.canonical, pageHost),
    Title: page.title || "(missing)",
    "Title chars": page.titleChars,
    "Title px(est)": page.title ? page.titlePx : 0,
    Description: page.metaDescription || "(missing)",
    "Desc chars": page.descChars,
    "Desc px(est)": page.metaDescription ? page.descPx : 0,
    Robots: robotsCombined || "(missing)",
    Viewport: page.viewport || "(missing)",
    Lang: page.lang || "(missing)",
  };

  const headingRows: AuditResult["headingRows"] = [];
  const headingsByLevel: Record<string, { count: number; texts: string[] }> = {};
  for (let i = 1; i <= 6; i++) {
    const tag = `h${i}`;
    const nodes = $(tag);
    const texts: string[] = [];
    nodes.each((_, el) => {
      const t = norm($(el).text());
      if (t) texts.push(t);
    });
    headingsByLevel[tag] = { count: nodes.length, texts };
    headingRows.push({
      Level: tag.toUpperCase(),
      Count: nodes.length,
      Samples: texts.slice(0, 6).join(" | ") || "(none)",
    });
  }
  const h1Count = headingsByLevel.h1?.count ?? 0;

  const telHrefSet = new Set<string>();
  const mailtoHrefSet = new Set<string>();
  $("a[href]").each((_, el) => {
    const h = norm($(el).attr("href") || "");
    if (/^tel:/i.test(h)) telHrefSet.add(h);
    if (/^mailto:/i.test(h)) mailtoHrefSet.add(h);
  });
  const telLinksDistinct = [...telHrefSet].sort((a, b) => a.localeCompare(b));
  const mailtoLinksDistinct = [...mailtoHrefSet].sort((a, b) => a.localeCompare(b));

  const canonicalValidBool = !!page.canonical && isHttpUrl(page.canonical, finalUrl);
  const canonicalSameHostBool = !!page.canonical && sameHost(page.canonical, pageHost);

  const coreAudit: CoreAudit = {
    Indexable: indexable ? "Yes" : "No",
    Followable: followable ? "Yes" : "No",
    Canonical: page.canonical || "(missing)",
    "Canonical count": page.canonicalCount,
    "Canonical valid": canonicalValidBool ? "Yes" : "No",
    "Canonical same host": canonicalSameHostBool ? "Yes" : "No",
    Title: page.title || "(missing)",
    Description: page.metaDescription || "(missing)",
    "Desc chars": page.descChars,
    "H1 count": h1Count,
    Robots: robotsCombined || "(missing)",
    "tel links": telLinksDistinct,
    "mailto links": mailtoLinksDistinct,
  };

  const bodyText = norm($("body").text() || "");
  const footerText = norm($("footer").text() || "");

  const nap: Record<string, boolean | null> = {
    "Business name found (body)": cfg.businessName
      ? includesLoose(bodyText, cfg.businessName)
      : null,
    "Phone found (body)": cfg.phone ? phoneMatches(bodyText, cfg.phone) : null,
    "Address/Service Area found (body)": cfg.addressOrServiceArea
      ? includesLoose(bodyText, cfg.addressOrServiceArea)
      : null,
    "Business name found (footer)": cfg.businessName
      ? includesLoose(footerText, cfg.businessName)
      : null,
    "Phone found (footer)": cfg.phone ? phoneMatches(footerText, cfg.phone) : null,
    "Address/Service Area found (footer)": cfg.addressOrServiceArea
      ? includesLoose(footerText, cfg.addressOrServiceArea)
      : null,
  };

  const telLinks: Array<{
    source: string;
    raw: string;
    displayText: string;
    digits: string;
  }> = [];
  $('a[href^="tel:"]').each((_, a) => {
    const $a = $(a);
    const rawHref = norm($a.attr("href") || "");
    const cleaned = rawHref.replace(/^tel:/i, "");
    telLinks.push({
      source: "tel: link",
      raw: rawHref,
      displayText: norm($a.text()),
      digits: digitsOnly(cleaned),
    });
  });

  const bodyInner = $("body").text() || "";
  const textMatches = bodyInner.match(phoneRegex) || [];
  const textRecords = textMatches.map((m) => {
    const raw = norm(m);
    return {
      source: "page text",
      raw,
      displayText: raw,
      digits: digitsOnly(raw),
    };
  });

  const phoneMap = new Map<string, (typeof telLinks)[0] & { source: string }>();
  for (const r of [...telLinks, ...textRecords]) {
    if (r.digits.length < 10) continue;
    const key = r.digits;
    const existing = phoneMap.get(key);
    if (!existing) {
      phoneMap.set(key, { ...r });
    } else {
      existing.source =
        existing.source === r.source ? existing.source : `${existing.source} + ${r.source}`;
    }
  }

  const phonesFound = [...phoneMap.values()].map((r) => ({
    ...r,
    digits:
      r.digits.startsWith("1") && r.digits.length === 11 ? r.digits.slice(1) : r.digits,
  }));

  const phoneTable = {
    "Unique phone numbers found": phonesFound.length,
    "tel: links found": telLinks.length,
    "Phone matches in page text": textMatches.length,
  };

  const expectedDigits = cfg.phone ? digitsOnly(cfg.phone) : "";
  const normalizedExpected =
    expectedDigits.startsWith("1") && expectedDigits.length === 11
      ? expectedDigits.slice(1)
      : expectedDigits;
  const foundDigitsSet = new Set(phonesFound.map((p) => p.digits));
  const hasExpectedPhoneOnPage = normalizedExpected
    ? foundDigitsSet.has(normalizedExpected)
    : null;
  const multiplePhones = phonesFound.length > 1;
  const otherPhones = normalizedExpected
    ? phonesFound.filter((p) => p.digits !== normalizedExpected)
    : phonesFound;

  const anchors = $("a");
  const absUrls: Array<{
    raw: string;
    abs: string;
    text: string;
    rel: string;
    target: string;
  }> = [];
  anchors.each((_, a) => {
    const $a = $(a);
    const raw = norm($a.attr("href") || "");
    if (!raw) return;
    absUrls.push({
      raw,
      abs: toAbs(raw, finalUrl),
      text: norm($a.text()),
      rel: norm($a.attr("rel") || ""),
      target: norm($a.attr("target") || ""),
    });
  });

  const internal = absUrls.filter((x) => x.abs && sameHost(x.abs, pageHost));
  const external = absUrls.filter(
    (x) => x.abs && !sameHost(x.abs, pageHost) && /^https?:/i.test(x.abs),
  );
  const mailto = absUrls.filter((x) => /^mailto:/i.test(x.raw));
  const tel = absUrls.filter((x) => /^tel:/i.test(x.raw));
  const jsLinks = absUrls.filter((x) => /^javascript:/i.test(x.raw));
  const hashOnly = absUrls.filter((x) => /^#/.test(x.raw));

  const anchorTextPairs = absUrls
    .filter((x) => x.text && x.abs)
    .map((x) => ({ text: x.text, abs: x.abs }));
  const anchorTextCounts = anchorTextPairs.reduce(
    (acc, { text }) => {
      const key = lc(text);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const repeatedAnchorTexts = Object.entries(anchorTextCounts)
    .filter(([, count]) => count >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([text, count]) => ({ anchorText: text.slice(0, 80), count }));

  const extWithBlank = absUrls.filter(
    (x) => x.target === "_blank" && /^https?:/i.test(x.abs) && !sameHost(x.abs, pageHost),
  );
  const missingNoopener = extWithBlank.filter((x) => !/\bnoopener\b/i.test(x.rel));
  const missingNoreferrer = extWithBlank.filter((x) => !/\bnoreferrer\b/i.test(x.rel));
  const extNofollow = external.filter((x) => /\bnofollow\b/i.test(x.rel));
  const httpLinks = absUrls.filter((x) => {
    const u = safeURL(x.abs, finalUrl);
    return !!u && u.protocol === "http:";
  });

  const httpLinkSamples = httpLinks.slice(0, 20).map((x) => ({
    href: x.abs,
    text: x.text.slice(0, 60),
  }));

  const linkTable = {
    "Total links (<a>)": anchors.length,
    "Internal links": internal.length,
    "External links": external.length,
    "mailto:": mailto.length,
    "tel:": tel.length,
    "javascript:": jsLinks.length,
    "hash-only (#)": hashOnly.length,
    "External nofollow": extNofollow.length,
    "HTTP links": httpLinks.length,
    "target=_blank missing noopener": missingNoopener.length,
    "target=_blank missing noreferrer": missingNoreferrer.length,
    "Repeated anchor texts (>=5)": repeatedAnchorTexts.length,
  };

  const imgs = $("img");
  const imgRecords: Array<{
    src: string;
    alt: string;
    isIcon: boolean;
    hasSize: boolean;
    keywordAlt: boolean;
  }> = [];
  imgs.each((_, img) => {
    const $img = $(img);
    const alt = $img.attr("alt");
    const altNorm = norm(alt);
    const cls = lc($img.attr("class") || "");
    const src = lc($img.attr("src") || "");
    const isIcon =
      cls.includes("icon") ||
      src.includes("icon") ||
      src.includes("sprite") ||
      src.endsWith(".svg");
    const wAttr = $img.attr("width");
    const hAttr = $img.attr("height");
    const hasSize = !!(wAttr && hAttr);
    const usesKeywordAlt = cfg.targetKeyword
      ? includesLoose(altNorm, cfg.targetKeyword)
      : false;
    imgRecords.push({
      src: norm($img.attr("src") || "").slice(0, 140),
      alt: alt === undefined ? "(missing)" : altNorm || '"" (empty)',
      isIcon,
      hasSize,
      keywordAlt: usesKeywordAlt,
    });
  });

  const missingAlt = imgRecords.filter((r) => r.alt === "(missing)");
  const iconWithKeywordAlt = imgRecords.filter((r) => r.isIcon && r.keywordAlt);
  const missingSize = imgRecords.filter((r) => !r.hasSize);

  const imageTable = {
    "Total images": imgs.length,
    "Missing alt attribute": missingAlt.length,
    'Empty alt ("")': imgRecords.filter((r) => r.alt.includes("(empty)")).length,
    "Missing width/height": missingSize.length,
    "Broken image candidates": 0,
    "Icons w/ keyword alt (should NOT)": iconWithKeywordAlt.length,
  };

  const missingAltSamples = missingAlt.slice(0, 20).map((r) => ({
    src: r.src,
    alt: r.alt,
    isIcon: r.isIcon,
  }));
  const iconKeywordAltSamples = iconWithKeywordAlt.slice(0, 20).map((r) => ({
    src: r.src,
    alt: r.alt,
  }));

  const jsonLdScripts = $('script[type="application/ld+json"]');
  const jsonLdTypes: string[] = [];
  const jsonLdErrors: string[] = [];

  function collectTypes(obj: unknown): void {
    if (!obj) return;
    if (Array.isArray(obj)) return obj.forEach(collectTypes);
    if (typeof obj === "object" && obj !== null) {
      const o = obj as Record<string, unknown>;
      if (o["@type"] !== undefined) {
        const t = o["@type"];
        if (Array.isArray(t)) t.forEach((x) => jsonLdTypes.push(String(x)));
        else jsonLdTypes.push(String(t));
      }
      for (const k of Object.keys(o)) collectTypes(o[k]);
    }
  }

  jsonLdScripts.each((_, s) => {
    const el = $(s);
    const text = (el.text() || el.html() || "").trim();
    try {
      const data = JSON.parse(text || "null");
      collectTypes(data);
    } catch {
      jsonLdErrors.push("Invalid JSON-LD block");
    }
  });

  const schemaTypesUnique = uniq(
    jsonLdTypes.flatMap((t) => (Array.isArray(t) ? t : [t])).map(String),
  );
  const hasFAQSchema = schemaTypesUnique.some((t) => lc(t).includes("faqpage"));

  const schemaTable = {
    "JSON-LD blocks": jsonLdScripts.length,
    "JSON-LD parse issues": jsonLdErrors.length,
    "Types (unique, top 20)": schemaTypesUnique.slice(0, 20).join(" | ") || "(none detected)",
    "FAQ schema detected": hasFAQSchema ? "Yes" : "No",
  };

  const ctaPhrases = [
    "get a free quote",
    "call now",
    "request a quote",
    "book now",
    "schedule",
    "contact us",
    "free estimate",
  ];
  const ctaFound = ctaPhrases.filter((p) => lc(bodyText).includes(p));
  let ctaButtons = 0;
  $("a, button").each((_, el) => {
    const t = lc($(el).text());
    if (ctaPhrases.some((p) => t.includes(p))) ctaButtons++;
  });

  const socialDomains = [
    "facebook.com",
    "instagram.com",
    "youtube.com",
    "tiktok.com",
    "x.com",
    "twitter.com",
    "linkedin.com",
  ];
  const footerLinks: Array<{ text: string; href: string; rel: string }> = [];
  $("footer a").each((_, a) => {
    const $a = $(a);
    const href = toAbs($a.attr("href") || "", finalUrl);
    if (!href) return;
    footerLinks.push({
      text: norm($a.text()),
      href,
      rel: norm($a.attr("rel") || ""),
    });
  });
  const socialLinks = footerLinks.filter((x) =>
    socialDomains.some((d) => x.href.includes(d)),
  );
  const socialNofollow = socialLinks.filter((x) => /\bnofollow\b/i.test(x.rel));
  const possibleGbpLinks = footerLinks.filter(
    (x) =>
      x.href.includes("google.com/maps") ||
      x.href.includes("goo.gl/maps") ||
      x.href.includes("g.page") ||
      x.href.includes("business.google.com"),
  );
  const mapIframes = $('iframe[src*="google.com/maps"], iframe[src*="www.google.com/maps"]');

  const mapTable = {
    "Google Maps iframes": mapIframes.length,
    "GBP/maps links (footer)": possibleGbpLinks.length,
    "Footer social links": socialLinks.length,
    "Footer social nofollow": socialNofollow.length,
  };

  const issues: Issue[] = [];
  const checks: Check[] = [];

  const addIssue = (severity: Issue["Severity"], area: string, issue: string, fix = "") =>
    issues.push({ Severity: severity, Area: area, Issue: issue, Fix: fix });
  const addCheck = (category: string, item: string, pass: boolean, notes = "") =>
    checks.push({
      Category: category,
      Check: item,
      Status: pass ? "✅ Pass" : "❌ Flag",
      Notes: notes,
    });

  addCheck(
    "Meta & Technical",
    "Page indexable (noindex not present)",
    indexable,
    robotsCombined ? robotsCombined : "No meta robots found (often OK)",
  );
  addCheck(
    "Meta & Technical",
    "Page followable (nofollow not present)",
    followable,
    robotsCombined ? robotsCombined : "No meta robots found (often OK)",
  );

  if (!indexable)
    addIssue("High", "Meta & Technical", "Page is set to NOINDEX.", "Remove noindex if this page should rank.");
  if (!followable)
    addIssue(
      "Med",
      "Meta & Technical",
      "Page is set to NOFOLLOW.",
      "Remove nofollow unless intentionally blocking link equity.",
    );

  const canonicalValid = !!page.canonical && isHttpUrl(page.canonical, finalUrl);
  const canonicalCountOk = page.canonicalCount <= 1;
  addCheck("Meta & Technical", "Canonical present", !!page.canonical, page.canonical || "Missing canonical");
  addCheck("Meta & Technical", "Single canonical tag", canonicalCountOk, `Found ${page.canonicalCount}`);
  addCheck(
    "Meta & Technical",
    "Canonical is valid absolute URL",
    canonicalValid,
    page.canonical || "(missing)",
  );

  if (!page.canonical) addIssue("Med", "Canonical", "Missing canonical URL.", "Add canonical to reduce duplicate URL risk.");
  if (!canonicalCountOk) addIssue("Med", "Canonical", "Multiple canonical tags found.", "Keep only one canonical per page.");
  if (page.canonical && !canonicalValid)
    addIssue("High", "Canonical", "Canonical is not a valid http(s) URL.", "Use an absolute http(s) canonical URL.");

  const titleOk = !!page.title;
  const titleHasKeyword = cfg.targetKeyword ? includesLoose(page.title, cfg.targetKeyword) : null;
  const titleNotTooWide = page.title ? page.titlePx <= 580 : false;
  addCheck("Meta Title", "Title present", titleOk, page.title || "(missing)");
  if (cfg.targetKeyword)
    addCheck("Meta Title", "Title includes primary keyword", !!titleHasKeyword, `Keyword: ${cfg.targetKeyword}`);
  addCheck("Meta Title", "Title not likely truncated (px est.)", titleNotTooWide, `px est: ${page.titlePx}`);

  if (!titleOk) addIssue("High", "Meta Title", "Missing <title> tag.", "Add a unique, descriptive title.");
  if (cfg.targetKeyword && !titleHasKeyword)
    addIssue("Med", "Meta Title", "Title missing target keyword (based on your input).", "Include primary keyword naturally.");
  if (page.title && !titleNotTooWide)
    addIssue("Low", "Meta Title", "Title likely too wide and may truncate.", "Shorten or front-load key terms.");

  const descOk = !!page.metaDescription;
  const descHasName = cfg.businessName ? includesLoose(page.metaDescription, cfg.businessName) : null;
  const descHasPhone = cfg.phone ? phoneMatches(page.metaDescription, cfg.phone) : null;
  const descHasLocation = cfg.locationTerm ? includesLoose(page.metaDescription, cfg.locationTerm) : null;

  addCheck("Meta Description", "Meta description present", descOk, page.metaDescription || "(missing)");
  if (cfg.businessName)
    addCheck("Meta Description", "Description includes business name", !!descHasName, cfg.businessName);
  if (cfg.phone) addCheck("Meta Description", "Description includes phone", !!descHasPhone, cfg.phone);
  if (cfg.locationTerm)
    addCheck("Meta Description", "Description includes location term", !!descHasLocation, cfg.locationTerm);
  addCheck(
    "Meta Description",
    "Description length reasonable (70-170 chars)",
    page.descChars >= 70 && page.descChars <= 170,
    `chars: ${page.descChars}`,
  );

  if (!descOk) addIssue("Med", "Meta Description", "Missing meta description.", "Add a unique description that supports CTR.");
  if (descOk && (page.descChars < 70 || page.descChars > 170))
    addIssue(
      "Low",
      "Meta Description",
      "Meta description length outside recommended range.",
      "Aim ~70–170 chars (avoid truncation).",
    );

  addCheck("Headings", "Exactly one H1", h1Count === 1, `H1 count: ${h1Count}`);
  if (h1Count === 0) addIssue("Med", "Headings", "No H1 found.", "Add one descriptive H1 aligned to the page intent.");
  if (h1Count > 1) addIssue("Low", "Headings", "Multiple H1s found.", "Usually OK, but simplify if structure feels messy.");

  const hasInternalLinks = internal.length > 0;
  addCheck("Links", "Has internal links", hasInternalLinks, `Internal: ${internal.length}`);
  addCheck("Links", "No HTTP links", httpLinks.length === 0, `HTTP count: ${httpLinks.length}`);
  addCheck("Links", "No javascript: links", jsLinks.length === 0, `javascript: count: ${jsLinks.length}`);
  addCheck(
    "Links",
    "Repeated anchor text not excessive",
    repeatedAnchorTexts.length === 0,
    repeatedAnchorTexts.length ? "See repeated anchor texts table" : "Good",
  );

  if (!hasInternalLinks)
    addIssue(
      "Med",
      "Links",
      "No internal links detected.",
      "Add contextual internal links (service pages should link to related services/locations/contact).",
    );
  if (httpLinks.length) addIssue("Med", "Links", "HTTP links detected.", "Update to HTTPS where possible.");
  if (jsLinks.length)
    addIssue("Med", "Links", "javascript: links detected.", "Replace with real URLs or proper buttons (accessibility + SEO).");

  addCheck("Images", "No missing alt attributes", missingAlt.length === 0, `Missing alt: ${missingAlt.length}`);
  addCheck(
    "Images",
    "Icons do NOT use keyword alt",
    iconWithKeywordAlt.length === 0,
    `Icons w/ keyword alt: ${iconWithKeywordAlt.length}`,
  );
  addCheck(
    "Images",
    "No broken images detected (best-effort)",
    true,
    "Server fetch cannot verify image load; use browser for broken image check.",
  );
  addCheck(
    "Images",
    "Width/height set (CLS help)",
    missingSize.length === 0,
    `Missing size: ${missingSize.length}`,
  );

  if (missingAlt.length)
    addIssue(
      "Med",
      "Images",
      `${missingAlt.length} image(s) missing alt attribute.`,
      'Add alt text or alt="" for decorative images.',
    );
  if (iconWithKeywordAlt.length)
    addIssue(
      "Med",
      "Images",
      "Icons appear to have keyword-based alt text (should not).",
      "Remove keyword alt from icons; reserve keyword alt for relevant photos.",
    );
  if (missingSize.length)
    addIssue(
      "Low",
      "Images",
      "Some images missing width/height attributes (CLS risk).",
      "Add explicit dimensions or CSS aspect-ratio.",
    );

  if (cfg.businessName)
    addCheck("NAP", "Business name present on page", nap["Business name found (body)"] === true, "Body scan");
  if (cfg.phone) addCheck("NAP", "Phone present on page (string match)", nap["Phone found (body)"] === true, "Body scan");
  if (cfg.addressOrServiceArea)
    addCheck(
      "NAP",
      "Address/Service area present on page",
      nap["Address/Service Area found (body)"] === true,
      "Body scan",
    );

  if (cfg.businessName && !nap["Business name found (body)"])
    addIssue(
      "Med",
      "NAP",
      "Business name not found in page text (based on your input).",
      "Confirm NAP placement in header/footer/contact sections.",
    );
  if (cfg.phone && !nap["Phone found (body)"])
    addIssue(
      "Med",
      "NAP",
      "Phone not found in page text (based on your input).",
      "Confirm phone appears in header/footer/contact and matches GBP.",
    );
  if (cfg.addressOrServiceArea && !nap["Address/Service Area found (body)"])
    addIssue(
      "Low",
      "NAP",
      "Address/service area text not found in page text (based on your input).",
      "Confirm consistency in footer/contact/location sections.",
    );

  addCheck(
    "Phone Numbers",
    "At least 1 phone number found on page",
    phonesFound.length > 0,
    `Found: ${phonesFound.length}`,
  );
  if (cfg.phone)
    addCheck(
      "Phone Numbers",
      "Expected GBP phone appears among detected numbers",
      !!hasExpectedPhoneOnPage,
      normalizedExpected ? `Expected digits: ${normalizedExpected}` : "No expected phone provided",
    );
  addCheck(
    "Phone Numbers",
    "No multiple different phone numbers (potential inconsistency)",
    !multiplePhones,
    multiplePhones ? "Multiple unique numbers detected—review table" : "Single number detected",
  );

  if (phonesFound.length === 0)
    addIssue("Med", "Phone Numbers", "No phone-like numbers detected on the page.", "Confirm phone is visible and/or add tel: link.");
  if (cfg.phone && hasExpectedPhoneOnPage === false)
    addIssue(
      "High",
      "Phone Numbers",
      "Expected GBP phone NOT found among detected phone numbers.",
      "Fix NAP consistency; update header/footer/buttons and tel: links.",
    );
  if (multiplePhones)
    addIssue(
      "Med",
      "Phone Numbers",
      "Multiple different phone numbers detected on page (possible NAP inconsistency).",
      normalizedExpected
        ? `Expected: ${normalizedExpected}. Review other numbers: ${otherPhones.map((p) => p.digits).join(", ")}`
        : "Review and confirm which number should be used sitewide.",
    );

  addCheck(
    "CTAs",
    "CTA text present (Get a Free Quote / Call Now / etc.)",
    ctaFound.length > 0 || ctaButtons > 0,
    ctaFound.length ? `Found: ${ctaFound.join(", ")}` : `Buttons found: ${ctaButtons}`,
  );
  if (ctaFound.length === 0 && ctaButtons === 0)
    addIssue(
      "Low",
      "CTAs",
      "No common CTA phrases detected.",
      'Add/ensure CTAs: "Get a Free Quote", "Call Now", buttons top/mid/bottom.',
    );

  addCheck("Schema", "JSON-LD present", jsonLdScripts.length > 0, `Blocks: ${jsonLdScripts.length}`);
  addCheck(
    "Schema",
    "FAQ schema detected (if page has FAQs)",
    hasFAQSchema,
    schemaTypesUnique.slice(0, 8).join(" | ") || "No types detected",
  );
  if (jsonLdErrors.length)
    addIssue("Med", "Schema", "Invalid JSON-LD detected.", "Fix JSON-LD formatting (must be valid JSON).");
  if (!jsonLdScripts.length)
    addIssue(
      "Low",
      "Schema",
      "No JSON-LD detected.",
      "Consider adding schema (Organization/LocalBusiness/Service/FAQPage where appropriate).",
    );

  addCheck("Footer", "Footer exists", $("footer").length > 0, $("footer").length ? "Footer found" : "No <footer> tag found");
  addCheck(
    "Footer",
    "Social links not set to nofollow",
    socialNofollow.length === 0,
    `Social links: ${socialLinks.length}, nofollow: ${socialNofollow.length}`,
  );
  if (socialNofollow.length)
    addIssue("Low", "Footer", "Some social links are nofollow.", "If SOP requires follow, remove nofollow from social links.");

  addCheck(
    "Location Pages",
    "Google map embed present (if location page)",
    mapIframes.length > 0 || possibleGbpLinks.length > 0,
    `iframes: ${mapIframes.length}, links: ${possibleGbpLinks.length}`,
  );

  const sortedIssues = issues.sort(
    (a, b) => (severityRank[a.Severity] ?? 9) - (severityRank[b.Severity] ?? 9),
  );

  const markdown = [
    `# On-page audit`,
    ``,
    `**URL:** ${finalUrl}`,
    ``,
    ...Object.entries(coreAudit).map(([k, v]) => {
      const display = Array.isArray(v)
        ? v.length
          ? v.join("; ")
          : "(none)"
        : v;
      return `- **${k}:** ${display}`;
    }),
    ``,
    `_Server-side HTML fetch — interactive checks (forms, console, PageSpeed) are manual._`,
  ].join("\n");

  return {
    url: pageUrl,
    finalUrl,
    cfg,
    coreAudit,
    meta,
    headingRows,
    linkTable,
    repeatedAnchorTexts,
    httpLinkSamples,
    imageTable,
    missingAltSamples,
    iconKeywordAltSamples,
    schemaTable,
    nap,
    phoneTable,
    phonesFound,
    mapTable,
    checks,
    issues: sortedIssues.map((i) => ({ ...i, route: routeIssue(i) })),
    markdown,
    snapshot: {
      indexable,
      followable,
      canonical: page.canonical,
      h1Count,
      internal: internal.length,
      external: external.length,
      httpLinks: httpLinks.length,
      imgs: imgs.length,
      missingAlt: missingAlt.length,
      phonesFound: phonesFound.length,
      expectedPhonePresent: hasExpectedPhoneOnPage,
      jsonLdBlocks: jsonLdScripts.length,
      hasFAQSchema,
    },
  };
}
