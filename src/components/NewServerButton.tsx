"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// optional: if you have a toast hook
// import { useToast } from "@/components/ui/use-toast";

type Flavor = "vanilla" | "fabric" | "forge" | "neoforge";

export default function NewServerButton({
  onCreated,
  onBusyChange,
}: {
  onCreated?: () => void;
  onBusyChange?: (active: boolean, label?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [name, setName] = useState("mc-new");
  const [flavor, setFlavor] = useState<Flavor>("vanilla");
  const [version, setVersion] = useState("latest");
  const [memory, setMemory] = useState("4G");
  const [port, setPort] = useState("25565");
  const [cfZipUrl, setCfZipUrl] = useState("");
  const [eula, _setEula] = useState(false);
  const [installOptimizations, setInstallOptimizations] = useState(false); // new checkbox

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // const { toast } = useToast?.() ?? { toast: console.log };

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  async function create() {
    setBusy(true);
    setErr(null);

    // Show progress bar
    onBusyChange?.(true, `Starting install for “${name}” (${flavor})…`);
    // Close modal so the bar is visible
    setOpen(false);

    try {
      const r = await fetch("/api/servers/create?stream=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name, flavor, version, memory, port, eula,
          curseforgeServerZipUrl: cfZipUrl || undefined,
          installOptimizations, // passes through (installer can ignore if not implemented yet)
        }),
      });

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(text || `Create failed (HTTP ${r.status})`);
      }

      const reader = r.body?.getReader();
      if (!reader) throw new Error("No stream from server");

      const decoder = new TextDecoder();
      let buf = "";
      let hadError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx: number;
        // eslint-disable-next-line no-cond-assign
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);

          if (!line) continue;

          if (line.startsWith("ERROR ")) {
            hadError = line.slice(6);
            onBusyChange?.(true, `Error: ${hadError}`);
          } else if (line.startsWith("DONE ")) {
            onBusyChange?.(true, "Finished.");
          } else {
            onBusyChange?.(true, line);
          }
        }
      }

      if (hadError) {
        setErr(hadError);
        // toast?.({ title: "Create failed", description: hadError });
        onBusyChange?.(false);
        return;
      }

      onBusyChange?.(false);
      onCreated?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      // toast?.({ title: "Create failed", description: msg });
      onBusyChange?.(false);
    } finally {
      setBusy(false);
    }
  }

  const modal = open ? (
    <div className="fixed inset-0 z-[100000] isolate">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !busy && setOpen(false)} />
      <div className="relative z-[100001] mx-auto mt-16 w-[min(720px,94vw)]">
        <div className="rounded-2xl border border-white/15 bg-[rgba(20,22,28,0.92)] backdrop-blur-2xl shadow-[0_24px_80px_rgba(0,0,0,0.7)] max-h-[85dvh] overflow-auto p-5 space-y-4">
          <div className="text-lg font-semibold">Create New Server</div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-white/60 mb-1">Folder / Name</div>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div>
              <div className="text-xs text-white/60 mb-1">Flavor</div>
              <select
                value={flavor}
                onChange={(e) => setFlavor(e.target.value as Flavor)}
                className="w-full rounded-md border border-white/15 bg-white/10 px-3 py-2"
              >
                <option value="vanilla">Vanilla</option>
                <option value="fabric">Fabric</option>
                <option value="forge">Forge</option>
                <option value="neoforge">NeoForge</option>
              </select>
            </div>

            <div>
              <div className="text-xs text-white/60 mb-1">Minecraft Version</div>
              <Input placeholder="latest or e.g. 1.21.1" value={version} onChange={(e) => setVersion(e.target.value)} />
            </div>

            <div>
              <div className="text-xs text-white/60 mb-1">Max Memory (JVM)</div>
              <Input placeholder="4G" value={memory} onChange={(e) => setMemory(e.target.value)} />
            </div>

            <div>
              <div className="text-xs text-white/60 mb-1">Server Port</div>
              <Input placeholder="25565" value={port} onChange={(e) => setPort(e.target.value)} />
            </div>

            <div className="sm:col-span-2">
              <div className="text-xs text-white/60 mb-1">CurseForge Server Pack ZIP URL (optional)</div>
              <Input placeholder="https://edge.forgecdn.net/files/.../pack-server.zip" value={cfZipUrl} onChange={(e) => setCfZipUrl(e.target.value)} />
            </div>

            <label className="sm:col-span-2 flex items-center gap-2 text-sm text-white/80">
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-400"
                checked={installOptimizations}
                onChange={(e) => setInstallOptimizations(e.target.checked)}
              />
              Install common performance mods (where applicable)
            </label>
          </div>

          {err && <div className="text-rose-400 text-sm">{err}</div>}

          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)} className="bg-white/10 hover:bg-white/20">Cancel</Button>
            <Button onClick={create} disabled={busy} className="bg-green-500/80 hover:bg-green-500">
              {busy ? "Installing…" : "Create"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <Button className="bg-white/10 hover:bg-white/20" onClick={() => setOpen(true)}>＋ New Server</Button>
      {mounted && modal ? createPortal(modal, document.body) : null}
    </>
  );
}
