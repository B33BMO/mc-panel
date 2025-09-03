"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import StatBadge from "./StatBadge";

type Stats = {
  cpu: number; // percent 0..100
  ram: { usedMB: number; totalMB?: number; pct?: number };
  gpu?: { usedMB?: number; totalMB?: number; pct?: number } | null;
  players?: { online: number; max?: number } | null;
  pid?: number | null;
  running: boolean;
};

export default function ServerPanel({ name }: { name: string }) {
  const { toast } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [cmd, setCmd] = useState("");
  const [streaming, setStreaming] = useState(false);

  // Single <pre> console buffer
  const logRef = useRef<HTMLPreElement>(null);
  const evtRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/servers/${encodeURIComponent(name)}/stats`, { cache: "no-store" });
    const d = await r.json();
    setStats(d);
  }, [name]);

  const fire = async (action: "start" | "stop" | "restart") => {
    const r = await fetch(`/api/servers/${encodeURIComponent(name)}/${action}`, { method: "POST" });
    const d = await r.json();
    toast({ title: action.toUpperCase(), description: d.message ?? "OK" });
    refresh();
  };

  const sendRcon = async () => {
    const cmdTrim = cmd.trim();
    if (!cmdTrim) return;
    const r = await fetch(`/api/servers/${encodeURIComponent(name)}/rcon/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: cmdTrim }),
    });
    const d = await r.json();
    setCmd("");
    if (d.ok) toast({ title: "RCON", description: d.output ?? "sent" });
    else toast({ title: "RCON error", description: d.error ?? "failed" });
  };

  // Efficient console appender with cap
  const appendLine = (line: string) => {
    const el = logRef.current;
    if (!el) return;
    const prev = el.dataset.buf || "";
    const merged = prev ? prev + "\n" + line : line;
    const lines = merged.split(/\r?\n/);
    const trimmed = lines.slice(-1000).join("\n"); // keep last 1000 lines
    el.textContent = trimmed;
    el.dataset.buf = trimmed;
    el.scrollTop = el.scrollHeight;
  };

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (evtRef.current) evtRef.current.close();
    const es = new EventSource(`/api/servers/${encodeURIComponent(name)}/rcon/stream`);
    es.onmessage = (e) => { setStreaming(true); appendLine(e.data); };
    es.onerror = () => { setStreaming(false); };
    evtRef.current = es;
    return () => es.close();
  }, [name]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex gap-3">
        <Button className="bg-green-500/80 hover:bg-green-500" onClick={() => fire("start")}>Start</Button>
        <Button className="bg-amber-500/80 hover:bg-amber-500" onClick={() => fire("stop")}>Stop</Button>
        <Button className="bg-yellow-500/80 hover:bg-yellow-500" onClick={() => fire("restart")}>Restart</Button>
      </div>

      {/* Status badges */}
      <Card className="panel">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatBadge label="Status" value={stats?.running ? "Running" : "Stopped"} />
            <StatBadge label="CPU" value={`${stats?.cpu?.toFixed?.(1) ?? 0}%`} />
            <StatBadge
              label="RAM"
              value={
                stats?.ram?.pct != null
                  ? `${stats.ram.pct.toFixed(1)}%`
                  : `${stats?.ram?.usedMB ?? 0}MB`
              }
            />
            {stats?.gpu && (
              <StatBadge
                label="GPU"
                value={stats.gpu.pct != null ? `${stats.gpu.pct.toFixed(1)}%` : `${stats.gpu.usedMB ?? 0}MB`}
              />
            )}
            {stats?.players && <StatBadge label="Players" value={`${stats.players.online}/${stats.players.max ?? "?"}`} />}
            {stats?.pid && <StatBadge label="PID" value={`${stats.pid}`} />}
          </div>
        </CardContent>
      </Card>

      {/* Console */}
      <div className="panel p-4">
        <div className="mb-2 text-white/70">Server RCON / Console</div>
        <pre ref={logRef} className="console" />
        <Separator className="my-3 opacity-40" />
        <div className="flex gap-2">
          <Input
            placeholder="Type RCON command…"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") sendRcon(); }}
          />
          <Button onClick={sendRcon}>Send</Button>
        </div>
        {!streaming && <div className="mt-2 text-xs text-white/50">Connecting to log stream…</div>}
      </div>
    </div>
  );
}
