import { NextResponse } from "next/server";
import { createServer } from "@/lib/installers";

type Body = {
  name: string;
  flavor: "vanilla" | "fabric" | "forge" | "neoforge";
  version: string;
  memory: string;
  port: string;
  eula: boolean;
  curseforgeServerZipUrl?: string;
};

export async function POST(req: Request) {
  const url = new URL(req.url);
  const streamMode = url.searchParams.get("stream") === "1";
  const body = (await req.json()) as Body;

  if (!streamMode) {
    // non-streamed simple create (rarely used)
    const out = await createServer(body, () => {});
    return NextResponse.json(out);
  }

  // Stream progress lines
  const stream = new ReadableStream({
    async start(controller) {
      const write = (line: string) =>
        controller.enqueue(new TextEncoder().encode(line + "\n"));
      try {
        const out = await createServer(body, async (m) => write(m));
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
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
