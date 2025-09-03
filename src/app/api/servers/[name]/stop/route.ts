import { NextResponse } from "next/server";
import { stopServer } from "@/lib/servers";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params;
  await stopServer(name);
  return NextResponse.json({ ok: true });
}
