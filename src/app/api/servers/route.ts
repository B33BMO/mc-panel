import { NextResponse } from "next/server";
import { listServers } from "@/lib/servers";

export async function GET() {
  return NextResponse.json({ servers: listServers() });
}
