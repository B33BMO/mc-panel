import { NextResponse } from "next/server";
import { createServer } from "@/lib/installers";

export const runtime = "nodejs";            // force Node runtime (not Edge)
export const dynamic = "force-dynamic";     // disable static optimization for streaming

type Body = {
  name: string;
  flavor: "vanilla" | "fabric" | "forge" | "neoforge";
  version: string;
  memory: string;
  port: string;
  eula: boolean;
  curseforgeServerZipUrl?: string;
  installOptimizations?: boolean; // harmless if not present
};

export async function POST(req: Request) {
  const url = new URL(req.url);
  const streamMode = url.searchParams.get("stream") === "1";

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    if (!streamMode) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    // stream error
    const stream = new ReadableStream({
      start(controller) {
        const write = (l: string) => controller.enqueue(new TextEncoder().encode(l + "\n"));
        write("ERROR Invalid JSON body");
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  if (!streamMode) {
    // Fallback non-stream
    const out = await createServer(body, () => {});
    return NextResponse.json(out);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const write = (line: string) => controller.enqueue(enc.encode(line + "\n"));

      // kick an initial line so the client reader starts immediately
      write("0% Starting…");

      try {
        const out = await createServer(body, (m) => write(m));
        write(`DONE ${JSON.stringify(out)}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        write(`ERROR ${msg}`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "X-Accel-Buffering": "no", // helps some proxies not buffer
    },
  });
}
