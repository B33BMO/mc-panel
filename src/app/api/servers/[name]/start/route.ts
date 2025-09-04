import { NextRequest, NextResponse } from "next/server";
import { startServer, type StartResult } from "@/lib/servers";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params;
  const out: StartResult = await startServer(name);
  return NextResponse.json(out, { status: out.ok ? 200 : 400 });
}
