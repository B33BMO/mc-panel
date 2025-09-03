import { NextResponse } from "next/server";
import { createServer } from "@/lib/installers";

type BodyBase = {
  name: string;
  flavor: "vanilla" | "fabric" | "forge" | "neoforge";
  version: string;
  memory: string;
  port: string;
  eula: boolean;
  curseforgeServerZipUrl?: string;
};

/** Extended body coming from the modal (checkbox) */
type Body = BodyBase & {
  /** If true, we’ll (eventually) add optimization mods after install */
  installOptimizations?: boolean;
};

export async function POST(req: Request) {
  const url = new URL(req.url);
  const streamMode = url.searchParams.get("stream") === "1";
  const body = (await req.json()) as Body;

  // Split out the checkbox flag (so createServer receives only its known args)
  const { installOptimizations = false, ...createArgs } = body;

  if (!streamMode) {
    const out = await createServer(
      // keep type-safety without `any`
      createArgs as unknown as Parameters<typeof createServer>[0],
      () => {}
    );
    return NextResponse.json({
      ...out,
      installOptimizations, // echo back what was requested
    });
  }

  // Stream progress lines (SSE-like text stream)
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const write = (line: string) => controller.enqueue(enc.encode(line + "\n"));

      try {
        if (installOptimizations) {
          write("0% Optimization pack requested (will be applied after base install)...");
        }

        const out = await createServer(
          createArgs as unknown as Parameters<typeof createServer>[0],
          async (m) => write(m)
        );

        // If/when your installers.ts supports it, you can perform the mod step here
        // and stream additional progress lines. For now we just acknowledge:
        if (installOptimizations) {
          write("100% (note) Optimization pack requested — awaiting installer support.");
        }

        write(`DONE ${JSON.stringify({ ...out, installOptimizations })}`);
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
