import { NextResponse } from "next/server";
import { consoleCheckToMarkdown, runConsoleCheck } from "@/lib/console-check";

export const maxDuration = 120;

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

  try {
    const result = await runConsoleCheck(target);
    const markdown = consoleCheckToMarkdown(result);
    return NextResponse.json({ ...result, markdown });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Console check failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
