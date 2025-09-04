import { NextRequest, NextResponse } from "next/server";
import { restartServer, type StartResult } from "@/lib/servers";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params;              // await the Promise
  const out: StartResult = await restartServer(name);
  return NextResponse.json(out, { status: out.ok ? 200 : 400 });
}
