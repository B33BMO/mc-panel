// src/app/api/servers/[name]/rcon/stream/route.ts
import { NextRequest } from "next/server";
import { paths as P } from "@/lib/servers";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic"; // streaming-friendly

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> } // <-- params is a Promise
) {
  const { name } = await ctx.params; // <-- await it

  const logFile = path.join(P.server(name), "logs", "latest.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const tail = spawn("tail", ["-n", "200", "-F", logFile]);

      const pump = (b: Buffer) => {
        const lines = b.toString("utf8").split(/\r?\n/);
        for (const ln of lines) if (ln) controller.enqueue(enc.encode(ln + "\n"));
      };

      tail.stdout.on("data", pump);
      tail.stderr.on("data", pump);

      const close = () => {
        try { tail.kill("SIGTERM"); } catch {}
        controller.close();
      };

      tail.on("close", close);
      // Some runtimes expose an abort signal on the request; not in TS types everywhere
      req.signal?.addEventListener?.("abort", close);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
