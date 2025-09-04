import { NextRequest, NextResponse } from "next/server";
import { stats } from "@/lib/servers";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params;
  const data = await stats(name);
  return NextResponse.json(data);
}
