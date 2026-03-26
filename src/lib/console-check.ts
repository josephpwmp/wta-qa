import fs from "node:fs";
import type { Browser } from "playwright-core";

/**
 * Vercel’s runtime is not detected as AWS Lambda, so @sparticuz/chromium skips
 * al2023.tar.br (NSS libs like libnss3.so) and skips LD_LIBRARY_PATH setup.
 * Set Lambda-style env *before* the module loads so its top-level init runs.
 *
 * If a prior cold start left /tmp/chromium without al2023, executablePath() returns
 * early and never extracts NSS — remove the stale binary so a full extract runs.
 */
function prepareSparticuzForVercel(): void {
  if (!process.env.VERCEL) return;
  process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs20.x";
  process.env.AWS_LAMBDA_JS_RUNTIME ??= "nodejs20.x";

  const nssHint = "/tmp/al2023/lib/libnss3.so";
  try {
    if (fs.existsSync("/tmp/chromium") && !fs.existsSync(nssHint)) {
      fs.unlinkSync("/tmp/chromium");
    }
  } catch {
    /* ignore */
  }
}

async function launchChromium(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  if (process.env.VERCEL) {
    prepareSparticuzForVercel();
    const sparticuz = (await import("@sparticuz/chromium")).default;
    return chromium.launch({
      args: sparticuz.args,
      executablePath: await sparticuz.executablePath(),
      headless: true,
    });
  }
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

const MAX_ITEMS = 50;

/** Third-party URLs we omit from “HTTP 4xx/5xx” (noisy for headless / not site bugs). */
function isIgnoredThirdPartyUrl(urlStr: string): boolean {
  try {
    const h = new URL(urlStr).hostname.toLowerCase();
    return h.includes("nitropack");
  } catch {
    return /nitropack/i.test(urlStr);
  }
}

/**
 * Remove generic Chrome "Failed to load resource … 403" lines that pair with ignored NitroPack 403s.
 */
function stripConsoleGeneric403ForIgnoredNitro(consoleErrors: string[], ignoredNitro403Count: number): string[] {
  if (ignoredNitro403Count <= 0) return consoleErrors;
  const generic403 =
    /^Failed to load resource:\s*the server responded with a status of 403\s*\(\)\s*$/i;
  let remove = ignoredNitro403Count;
  return consoleErrors.filter((line) => {
    if (remove <= 0) return true;
    if (generic403.test(line.trim())) {
      remove--;
      return false;
    }
    return true;
  });
}

export type ConsoleCheckResult = {
  url: string;
  navigatedUrl: string | null;
  /** Initial navigation hit the timeout (page may be partial) */
  navigationTimedOut: boolean;
  consoleErrors: string[];
  consoleWarnings: string[];
  /** Uncaught exceptions in page */
  pageErrors: string[];
  /** Failed network requests (resource not loaded) */
  requestFailures: string[];
  /**
   * HTTP 4xx/5xx from completed responses (e.g. 403 on a script/font).
   * These often also appear as console "Failed to load resource" but do not trigger requestfailed.
   */
  httpErrorResponses: string[];
  /** Counts of lines omitted as known headless/serverless noise (not shown in lists). */
  omittedHeadlessNoise?: {
    requestFailures: number;
    consoleWarnings: number;
    consoleErrors: number;
  };
};

/**
 * Chrome logs a generic "Failed to load resource: … status N ()" without the URL.
 * If we already captured that status in `httpErrorResponses`, drop the redundant console line.
 */
function stripRedundantResourceConsoleErrors(
  consoleErrors: string[],
  httpErrorResponses: string[],
): string[] {
  const statusesFromHttp = new Set<number>();
  for (const line of httpErrorResponses) {
    const m = /^(\d{3})\s/.exec(line.trim());
    if (m) statusesFromHttp.add(Number(m[1]));
  }
  if (statusesFromHttp.size === 0) return consoleErrors;

  const genericRe =
    /^Failed to load resource:\s*the server responded with a status of (\d+)\s*\(\)\s*$/i;

  return consoleErrors.filter((line) => {
    const m = genericRe.exec(line.trim());
    if (!m) return true;
    const st = Number(m[1]);
    return !statusesFromHttp.has(st);
  });
}

function dedupeCap(arr: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const key = s.slice(0, 800);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.length > 2000 ? s.slice(0, 2000) + "…" : s);
    if (out.length >= max) break;
  }
  return out;
}

/** Chromium hits connection/memory limits in headless/serverless; real browsers rarely show this for the same page. */
function isInsufficientResourcesNoise(line: string): boolean {
  return /ERR_INSUFFICIENT_RESOURCES|insufficient resources/i.test(line);
}

/** Analytics / tag manager requests often abort in automation (navigation teardown, blocked third-party, or cascade after resource exhaustion). */
function isLikelyHeadlessAnalyticsAbort(line: string): boolean {
  if (!/ERR_ABORTED|aborted/i.test(line)) return false;
  return /google-analytics\.com|googletagmanager\.com|google\.com\/ccm|google\.com\/pagead|\/g\/collect|doubleclick\.net|facebook\.com\/tr|clarity\.ms|hotjar\.com|segment\.com/i.test(
    line,
  );
}

function isHeadlessNoiseRequestFailure(line: string): boolean {
  return isInsufficientResourcesNoise(line) || isLikelyHeadlessAnalyticsAbort(line);
}

/** GPU / WebGPU / autoplay — normal in headless; not what users see in desktop Chrome. */
function isHeadlessNoiseWarning(line: string): boolean {
  const t = line.trim();
  if (/WebGPU Context Provider|Failed to create WebGPU/i.test(t)) return true;
  if (/AudioContext was not allowed to start|user gesture/i.test(t)) return true;
  if (/GL Driver Message|GPU stall|ReadPixels|\.WebGL-/i.test(t)) return true;
  if (/swiftshader|ANGLE|WebGL.*Performance/i.test(t)) return true;
  return false;
}

/** Duplicate "Failed to load resource" console lines for resource exhaustion. */
function isHeadlessNoiseConsoleError(line: string): boolean {
  return isInsufficientResourcesNoise(line);
}

function partitionNoise(lines: string[], isNoise: (s: string) => boolean): { kept: string[]; dropped: number } {
  let dropped = 0;
  const kept: string[] = [];
  for (const line of lines) {
    if (isNoise(line)) dropped++;
    else kept.push(line);
  }
  return { kept, dropped };
}

export function consoleCheckToMarkdown(r: ConsoleCheckResult): string {
  const o = r.omittedHeadlessNoise;
  const omitNote =
    o && (o.requestFailures > 0 || o.consoleWarnings > 0 || o.consoleErrors > 0)
      ? `**Omitted (headless noise):** ${o.requestFailures} failed-request lines, ${o.consoleWarnings} warnings, ${o.consoleErrors} console errors — see UI note.`
      : null;
  const lines = [
    `# Browser console check`,
    ``,
    `**Requested URL:** ${r.url}`,
    r.navigatedUrl ? `**Final URL:** ${r.navigatedUrl}` : null,
    r.navigationTimedOut ? `**Note:** Initial navigation timed out; results may be partial.` : null,
    omitNote,
    ``,
    `## Console (error) — ${r.consoleErrors.length}`,
    ...(r.consoleErrors.length ? r.consoleErrors.map((e) => `- ${e}`) : [`- None`]),
    ``,
    `## Console (warning) — ${r.consoleWarnings.length}`,
    ...(r.consoleWarnings.length ? r.consoleWarnings.map((e) => `- ${e}`) : [`- None`]),
    ``,
    `## Uncaught page errors — ${r.pageErrors.length}`,
    ...(r.pageErrors.length ? r.pageErrors.map((e) => `- ${e}`) : [`- None`]),
    ``,
    `## Failed requests — ${r.requestFailures.length}`,
    ...(r.requestFailures.length ? r.requestFailures.map((e) => `- ${e}`) : [`- None`]),
    ``,
    `## HTTP error responses (4xx/5xx) — ${r.httpErrorResponses.length}`,
    ...(r.httpErrorResponses.length ? r.httpErrorResponses.map((e) => `- ${e}`) : [`- None`]),
  ];
  return lines.filter((x) => x !== null).join("\n");
}

export async function runConsoleCheck(targetUrl: string): Promise<ConsoleCheckResult> {
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  const httpErrorResponses: string[] = [];
  let ignoredNitro403Count = 0;

  let browser: Browser | undefined;
  let navigatedUrl: string | null = null;
  let navigationTimedOut = false;

  try {
    browser = await launchChromium();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      process.env.VERCEL
        ? `Could not launch Chromium for serverless (${msg}).`
        : `Could not launch Chromium (${msg}). Run: npm run playwright:install`,
    );
  }

  const page = await browser.newPage();

  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error") consoleErrors.push(text);
    else if (msg.type() === "warning") consoleWarnings.push(text);
  });

  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  page.on("requestfailed", (request) => {
    const u = request.url();
    if (isIgnoredThirdPartyUrl(u)) return;
    const f = request.failure();
    requestFailures.push(`${request.method()} ${u} — ${f?.errorText ?? "failed"}`);
  });

  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    const u = response.url();
    if (isIgnoredThirdPartyUrl(u)) {
      if (status === 403) ignoredNitro403Count++;
      return;
    }
    httpErrorResponses.push(`${status} ${response.statusText()} — ${u}`);
  });

  try {
    await page.goto(targetUrl, { waitUntil: "load", timeout: 45_000 });
    navigatedUrl = page.url();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout|Timeout/i.test(msg)) navigationTimedOut = true;
    try {
      navigatedUrl = page.url();
    } catch {
      navigatedUrl = null;
    }
  }

  await new Promise((r) => setTimeout(r, 2000));

  await browser.close().catch(() => {});

  const rfPart = partitionNoise(requestFailures, isHeadlessNoiseRequestFailure);
  const warnPart = partitionNoise(consoleWarnings, isHeadlessNoiseWarning);
  const errPart = partitionNoise(consoleErrors, isHeadlessNoiseConsoleError);

  const httpDeduped = dedupeCap(httpErrorResponses, MAX_ITEMS);
  let consoleDeduped = stripRedundantResourceConsoleErrors(errPart.kept, httpDeduped);
  consoleDeduped = stripConsoleGeneric403ForIgnoredNitro(consoleDeduped, ignoredNitro403Count);

  const omitted =
    rfPart.dropped + warnPart.dropped + errPart.dropped > 0
      ? {
          requestFailures: rfPart.dropped,
          consoleWarnings: warnPart.dropped,
          consoleErrors: errPart.dropped,
        }
      : undefined;

  return {
    url: targetUrl,
    navigatedUrl,
    navigationTimedOut,
    consoleErrors: dedupeCap(consoleDeduped, MAX_ITEMS),
    consoleWarnings: dedupeCap(warnPart.kept, MAX_ITEMS),
    pageErrors: dedupeCap(pageErrors, MAX_ITEMS),
    requestFailures: dedupeCap(rfPart.kept, MAX_ITEMS),
    httpErrorResponses: httpDeduped,
    omittedHeadlessNoise: omitted,
  };
}
