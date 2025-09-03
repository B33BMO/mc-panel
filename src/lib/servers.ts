import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import pidusage from "pidusage";
import { status } from "minecraft-server-util";

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
    fs.statSync(path.join(ROOT, n)).isDirectory(),
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

export type StartResult = { message: string; pid?: number };

/**
 * Start the server by invoking start.sh / start.bat (preferred).
 * Waits briefly for server.pid (written by start.sh) and returns it if found.
 * NOTE: no `ok` field here, so your route can do `{ ok: true, ...out }` safely.
 */
export async function startServer(name: string): Promise<StartResult> {
  const dir = paths.server(name);
  if (!fs.existsSync(dir)) return { message: "Server folder missing" };

  // guard against double start
  const current = readPid(name);
  if (isRunning(current)) return { message: `Already running (PID ${current})`, pid: current ?? undefined };

  // clear stale pid
  if (current && !isRunning(current)) {
    try { fs.unlinkSync(paths.pid(name)); } catch {}
  }

  let cmd: string | null = null;
  let args: string[] = [];
  let useShell = false;

  if (process.platform === "win32" && fs.existsSync(paths.startBat(name))) {
    // Launch minimized window with start.bat
    cmd = "cmd";
    args = ["/c", "start", "/min", "start.bat"];
    useShell = true;
  } else if (fs.existsSync(paths.startSh(name))) {
    // Ensure executable then run via bash -lc to respect shebang/path
    try { fs.chmodSync(paths.startSh(name), 0o755); } catch {}
    cmd = "bash";
    args = ["-lc", "./start.sh"];
  } else if (fs.existsSync(paths.jar(name))) {
    // last resort: run server.jar directly (no PID file, so we detach & return shell pid)
    cmd = JAVA;
    args = ["-Xmx4G", "-jar", "server.jar", "nogui"];
  }

  if (!cmd) return { message: "No start script or server.jar found" };

  const child = spawn(cmd, args, {
    cwd: dir,
    detached: true,
    stdio: "ignore",
    shell: useShell,
    env: { ...process.env, JAVA_PATH: process.env.JAVA_PATH || "" },
  });
  child.unref();

  // Wait up to ~2s for the start.sh to create server.pid with the *Java* PID.
  const pidFile = paths.pid(name);
  const waitForPid = async (): Promise<number | undefined> => {
    for (let i = 0; i < 14; i++) {
      await new Promise((r) => setTimeout(r, 150));
      if (fs.existsSync(pidFile)) {
        const pid = readPid(name) ?? undefined;
        if (pid && isRunning(pid)) return pid;
      }
    }
    return undefined;
  };

  const pid = await waitForPid();

  if (pid) return { message: "Started", pid };

  // If we didn’t get a pid file, we still started a process (shell/java).
  // Provide a helpful hint based on latest.log if present.
  const logPath = paths.log(name);
  let hint = "";
  try {
    if (fs.existsSync(logPath)) {
      const log = fs.readFileSync(logPath, "utf8");
      if (/You need to agree to the EULA/i.test(log)) {
        hint = " (EULA not accepted — ensure eula.txt has eula=true)";
      } else if (/Unable to access jarfile|Server jar not found/i.test(log)) {
        hint = " (server jar path may be wrong in start.sh)";
      } else if (/command not found: java|No such file or directory: .*java/i.test(log)) {
        hint = " (Java not found — install OpenJDK 17+ or set JAVA_PATH)";
      }
    }
  } catch {}

  return {
    message: `Start invoked. PID not yet visible; check ${logPath}${hint}`,
  };
}

export function stopServer(name: string): { ok: boolean; message: string } {
  const pid = readPid(name);
  if (!isRunning(pid)) return { ok: false, message: "Not running" };
  try { process.kill(pid!, "SIGTERM"); } catch {}
  return { ok: true, message: "Stopping…" };
}

export function restartServer(name: string) {
  stopServer(name);
  // intentionally don't await; let the caller await startServer if needed
  // If you prefer, make this async and await startServer
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

  // Player count via status ping (best-effort)
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
  } catch { /* likely offline */ }

  // GPU (best-effort via nvidia-smi)
  let gpu = null as null | { usedMB?: number; totalMB?: number; pct?: number };
  try {
    const out = execSync(
      "nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits",
      { stdio: ["ignore", "pipe", "ignore"] },
    )
      .toString()
      .trim();
    const [used, total, util] = out.split(",").map((s) => parseFloat(s.trim()));
    gpu = { usedMB: used, totalMB: total, pct: util };
  } catch { /* no nvidia-smi */ }

  const totalMB = undefined;
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
