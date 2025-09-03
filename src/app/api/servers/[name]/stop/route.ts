// src/app/api/servers/[name]/stop/route.ts
import { NextRequest, NextResponse } from "next/server";
import { stopServer, type StopResult } from "@/lib/servers";

export async function POST(
  _req: NextRequest,
  { params }: { params: { name: string } }
) {
  const out: StopResult = await stopServer(params.name);
  return NextResponse.json(out, { status: out.ok ? 200 : 400 });
}
