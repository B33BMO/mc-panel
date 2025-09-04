// src/app/api/servers/[name]/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { startServer, type StartResult } from "@/lib/servers";

export async function POST(
  _req: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params;
  const out: StartResult = await startServer(name);
  return NextResponse.json(out, { status: out.ok ? 200 : 400 });
}
