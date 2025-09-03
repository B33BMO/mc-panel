"use client";
import { useEffect, useMemo, useState } from "react";
import ServerTabs from "@/components/ServerTabs";
import ServerPanel from "@/components/ServerPanel";
import NewServerButton from "@/components/NewServerButton";
import LoadingBar from "@/components/LoadingBar";
import { Toaster } from "@/components/ui/toaster";

export default function Home() {
  const [servers, setServers] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);

  // NEW: creation progress state
  const [creating, setCreating] = useState(false);
  const [createLabel, setCreateLabel] = useState<string | undefined>(undefined);

  const loadServers = async () => {
    const r = await fetch("/api/servers", { cache: "no-store" });
    const d = await r.json();
    setServers(d.servers || []);
    setActive((prev) => prev ?? d.servers?.[0] ?? null);
  };

  useEffect(() => { loadServers(); }, []);
  const selected = useMemo(() => active, [active]);

  return (
    <main className="space-y-6">
      {/* TOP BAR: tabs + button */}
      <div className="panel p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <ServerTabs servers={servers} active={selected} onSelect={setActive} />
          </div>
          <NewServerButton
            onCreated={loadServers}
            onBusyChange={(active, label) => { setCreating(active); setCreateLabel(label); }}
          />
        </div>
      </div>

      {/* MAIN PANEL */}
      <div className="panel p-4 space-y-4">
        {selected ? (
          <ServerPanel name={selected} />
        ) : (
          <div className="text-white/60">No servers found.</div>
        )}

        {/* PROGRESS BAR pinned to the very bottom of this panel */}
        <LoadingBar active={creating} label={createLabel} />
      </div>

      <Toaster />
    </main>
  );
}
