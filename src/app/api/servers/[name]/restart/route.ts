import { NextResponse } from "next/server";
import { restartServer } from "@/lib/servers";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params;
  const out = await restartServer(name); // StartResult
  return NextResponse.json({ ok: true, ...out });
}
