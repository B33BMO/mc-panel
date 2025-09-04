import { NextRequest, NextResponse } from "next/server";
import { Rcon } from "rcon-client";
import fs from "node:fs";
import path from "node:path";
import { paths as P } from "@/lib/servers";

type ReqBody = { command?: string };

function readProps(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params; // <-- important

  const { command }: ReqBody = await req.json();

  const propsPath = path.join(P.server(name), "server.properties");
  const props = readProps(propsPath);
  const port = Number(props["rcon.port"] || 25575);
  const password =
    process.env.RCON_PASSWORD || props["rcon.password"] || "changeme123";

  try {
    const rcon = await Rcon.connect({ host: "127.0.0.1", port, password });
    const out = command ? await rcon.send(command) : "";
    rcon.end();
    return NextResponse.json({ ok: true, out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
