import { NextRequest } from "next/server";
import { paths as P } from "@/lib/servers";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> }   // <- Promise here
) {
  const { name } = await ctx.params;           // <- and await it
  const logFile = path.join(P.server(name), "logs", "latest.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const tail = spawn("tail", ["-n", "200", "-F", logFile]);

      const sendLine = (line: string) => {
        controller.enqueue(enc.encode(`data: ${line}\n\n`)); // SSE frame
      };
      const pump = (b: Buffer) => {
        for (const ln of b.toString("utf8").split(/\r?\n/)) if (ln) sendLine(ln);
      };

      tail.stdout.on("data", pump);
      tail.stderr.on("data", pump);

      const ping = setInterval(() => {
        controller.enqueue(enc.encode(`: ping ${Date.now()}\n\n`));
      }, 15000);

      const close = () => {
        clearInterval(ping);
        try { tail.kill("SIGTERM"); } catch {}
        try { controller.close(); } catch {}
      };

      tail.on("close", close);
      req.signal?.addEventListener?.("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
