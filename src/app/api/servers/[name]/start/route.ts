import { NextResponse } from "next/server";
import { startServer } from "@/lib/servers";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params;
  await startServer(name);
  return NextResponse.json({ ok: true });
}
