// src/app/api/servers/[name]/start/route.ts
import { NextResponse } from "next/server";
import { startServer } from "@/lib/servers";

export async function POST(
  _req: Request,
  { params }: { params: { name: string } }
) {
  try {
    const { name } = params;
    if (!name) {
      return NextResponse.json({ ok: false, error: "Missing server name" }, { status: 400 });
    }
    const out = await startServer(name);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
