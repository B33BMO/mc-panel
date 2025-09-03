import { paths as P } from "@/lib/servers";
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params;

  const logFile = path.join(P.server(name), "logs", "latest.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();

      // tail -F will follow even if the file is rotated/recreated
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

      // Proper abort: use the request's signal
      req.signal?.addEventListener?.("abort", close);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
