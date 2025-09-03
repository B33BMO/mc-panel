import { NextResponse } from "next/server";
import { stats } from "@/lib/servers";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params; // IMPORTANT: await
  const data = await stats(name);
  return NextResponse.json(data);
}
