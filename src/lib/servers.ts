import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import pidusage from "pidusage";
import { status } from "minecraft-server-util";

export type StartResult = { ok: boolean; message: string; pid?: number };
export type StopResult  = { ok: boolean; message: string };

const ROOT = process.env.SERVERS_ROOT || path.resolve(process.cwd(), "servers");
const JAVA = process.env.JAVA_PATH || "java";

export const paths = {
  root: ROOT,
  server: (name: string) => path.join(ROOT, name),
  pid: (name: string) => path.join(ROOT, name, "server.pid"),
  log: (name: string) => path.join(ROOT, name, "logs", "latest.log"),
  startSh: (name: string) => path.join(ROOT, name, "start.sh"),
  startBat: (name: string) => path.join(ROOT, name, "start.bat"),
  jar: (name: string) => path.join(ROOT, name, "server.jar"),
};

export function listServers(): string[] {
  if (!fs.existsSync(ROOT)) return [];
  return fs.readdirSync(ROOT).filter((n) =>
    fs.statSync(path.join(ROOT, n)).isDirectory()
  );
}

export function readPid(name: string): number | null {
  try {
    const s = fs.readFileSync(paths.pid(name), "utf8").trim();
    const pid = parseInt(s, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function isRunning(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function startServer(name: string): StartResult {
  const dir = paths.server(name);
  if (!fs.existsSync(dir)) return { ok: false, message: "Server folder missing" };

  const pid = readPid(name);
  if (isRunning(pid)) return { ok: false, message: "Already running", pid: pid ?? undefined };

  let cmd: string | null = null;
  let args: string[] = [];
  let shell = false;

  if (process.platform === "win32" && fs.existsSync(paths.startBat(name))) {
    cmd = "cmd";
    args = ["/c", "start", "/min", "start.bat"];
    shell = true;
  } else if (fs.existsSync(paths.startSh(name))) {
    cmd = "bash";
    args = ["start.sh"];
  } else if (fs.existsSync(paths.jar(name))) {
    cmd = JAVA;
    args = ["-Xmx4G", "-jar", "server.jar", "nogui"];
  }

  if (!cmd) return { ok: false, message: "No start script or server.jar found" };

  const child = spawn(cmd, args, { cwd: dir, detached: true, stdio: "ignore", shell });
  child.unref();
  if (child.pid) fs.writeFileSync(paths.pid(name), String(child.pid), "utf8");
  return { ok: true, message: `Launched (pid ${child.pid ?? "?"})`, pid: child.pid ?? undefined };
}

export function stopServer(name: string): StopResult {
  const pid = readPid(name);
  if (!isRunning(pid)) return { ok: false, message: "Not running" };
  try { process.kill(pid!, "SIGTERM"); } catch {}
  return { ok: true, message: "Stopping…" };
}

export function restartServer(name: string): StartResult {
  stopServer(name);
  return startServer(name);
}

export async function stats(name: string) {
  const pid = readPid(name);
  const running = isRunning(pid);
  let cpu = 0, memMB = 0;

  if (running) {
    const p = await pidusage(pid!);
    cpu = p.cpu;
    memMB = (p.memory ?? 0) / (1024 * 1024);
  }

  // Player count via status ping (not RCON)
  let players: { online: number; max?: number } | null = null;
  try {
    const serverProps = path.join(paths.server(name), "server.properties");
    let port = 25565;
    if (fs.existsSync(serverProps)) {
      const t = fs.readFileSync(serverProps, "utf8");
      const m = t.match(/server-port=(\d+)/);
      if (m) port = parseInt(m[1], 10);
    }
    const res = await status("127.0.0.1", port, { timeout: 5000 });
    players = { online: res.players.online, max: res.players.max };
  } catch {
    /* offline or ping failed */
  }

  // GPU (best-effort via nvidia-smi)
  let gpu = null as null | { usedMB?: number; totalMB?: number; pct?: number };
  try {
    const out = execSync(
      "nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits",
      { stdio: ["ignore", "pipe", "ignore"] }
    ).toString().trim();
    const [used, total, util] = out.split(",").map((s) => parseFloat(s.trim()));
    gpu = { usedMB: used, totalMB: total, pct: util };
  } catch {
    // no nvidia-smi available
  }

  const totalMB = undefined; // could probe system RAM if desired
  const pct = totalMB ? (memMB / totalMB) * 100 : undefined;

  return {
    pid: pid ?? null,
    running,
    cpu,
    ram: { usedMB: Math.round(memMB), totalMB, pct },
    gpu,
    players,
  };
}
