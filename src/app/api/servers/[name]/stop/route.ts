import { NextResponse } from "next/server";
import { stopServer } from "@/lib/servers";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params;
  const out = await stopServer(name); // { ok, message }
  return NextResponse.json(out, { status: out.ok ? 200 : 400 });
}
