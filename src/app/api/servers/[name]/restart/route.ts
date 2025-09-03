// src/app/api/servers/[name]/restart/route.ts
import { NextRequest, NextResponse } from "next/server";
import { restartServer, type StartResult } from "@/lib/servers";

export async function POST(
  _req: NextRequest,
  { params }: { params: { name: string } }
) {
  const out: StartResult = await restartServer(params.name);
  return NextResponse.json(out, { status: out.ok ? 200 : 400 });
}
