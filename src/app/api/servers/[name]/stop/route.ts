import { NextRequest, NextResponse } from "next/server";
import { stopServer, type StopResult } from "@/lib/servers";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params;
  const out: StopResult = await stopServer(name);
  return NextResponse.json(out, { status: out.ok ? 200 : 400 });
}
