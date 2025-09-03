import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import https from "node:https";
import type { IncomingMessage } from "http";
import { paths as P } from "@/lib/servers";

/* ---------------------------- misc utilities ---------------------------- */

function diskFreeKB(dir: string): number | null {
  try {
    const r = spawnSync("df", ["-k", dir], { encoding: "utf8" });
    if (r.status !== 0) return null;
    const lines = r.stdout.trim().split(/\r?\n/);
    const parts = lines[lines.length - 1].trim().split(/\s+/);
    const avail = parseInt(parts[3], 10);
    return Number.isFinite(avail) ? avail : null;
  } catch {
    return null;
  }
}

function safeRm(p: string) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

/* ------------------------------ progress -------------------------------- */

type Stepper = (msg: string) => void | Promise<void>;

class Progress {
  private base = 0;
  private segStart = 0;
  private segWeight = 0;
  constructor(private say: Stepper) {}
  start(weight: number, msg?: string) {
    this.segStart = this.base;
    this.segWeight = Math.max(0, Math.min(1, weight));
    if (msg) this.emit(0, msg);
  }
  emit(ratio: number, msg: string) {
    const pct = Math.round(
      (this.segStart + this.segWeight * Math.max(0, Math.min(1, ratio))) * 100,
    );
    this.say(`${pct}% ${msg}`);
  }
  end(doneMsg?: string) {
    this.base = Math.min(1, this.segStart + this.segWeight);
    this.segWeight = 0;
    if (doneMsg) this.say(`${Math.round(this.base * 100)}% ${doneMsg}`);
  }
}

/* -------------------------------- consts -------------------------------- */

const DEFAULT_RCON_PASSWORD = process.env.RCON_PASSWORD || "changeme123";
const UA = "mc-panel/1.0";

const MOJANG_MANIFEST =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_INSTALLER_LIST =
  "https://meta.fabricmc.net/v2/versions/installer";
const FORGE_PROMOS =
  "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const NEOFORGE_META =
  "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";

/* --------------------------------- types --------------------------------- */

type Flavor = "vanilla" | "fabric" | "forge" | "neoforge";
type CreateArgs = {
  name: string;
  flavor: Flavor;
  version: string;
  memory: string;
  port: string;
  eula: boolean;
  curseforgeServerZipUrl?: string;
  /** Add common server-side optimization mods (where compatible) */
  optimize?: boolean;
};

type Loader = "fabric" | "quilt" | "forge" | "neoforge";

/* ------------------------------- networking ------------------------------ */

function httpGet(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const opts: https.RequestOptions = {
      headers: { "User-Agent": UA, ...(extraHeaders || {}) },
    };
    const doGet = (u: string, hop = 0) => {
      if (hop > 10) return reject(new Error("Too many redirects"));
      https
        .get(u, opts, (res) => {
          const code = res.statusCode ?? 0;
          if (code >= 300 && code < 400 && res.headers.location) {
            const next = new URL(String(res.headers.location), u).toString();
            res.resume();
            doGet(next, hop + 1);
            return;
          }
          if (code >= 400) {
            reject(new Error(`GET ${u} -> ${code}`));
          } else {
            resolve(res);
          }
        })
        .on("error", reject);
    };
    doGet(url);
  });
}

/** Download with optional byte-progress callback (ratio 0..1 when Content-Length is known) */
async function download(
  url: string,
  dest: string,
  onProgress?: (ratio: number) => void,
) {
  ensureDir(path.dirname(dest));
  const rs = await httpGet(url);
  const lenHeader = rs.headers["content-length"];
  const total = Number(Array.isArray(lenHeader) ? lenHeader[0] : lenHeader || 0);
  let seen = 0;

  await new Promise<void>((resolve, reject) => {
    const ws = fs.createWriteStream(dest);
    rs.on("data", (chunk: Buffer) => {
      seen += chunk.length;
      if (total && onProgress) onProgress(seen / total);
    });
    rs.on("error", reject);
    ws.on("error", reject);
    ws.on("finish", resolve);
    rs.pipe(ws);
  });
}

/* -------------------------------- helpers -------------------------------- */

function assertZipMagic(filePath: string) {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(4);
  fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  if (!(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) {
    throw new Error("Downloaded file is not a ZIP (bad magic bytes).");
  }
}

function makeScriptsInvokeRunner(
  dir: string,
  runner: { unix: string; win: string },
) {
  ensureDir(path.join(dir, "logs"));
  try {
    fs.chmodSync(path.join(dir, "run.sh"), 0o755);
  } catch {}
  const sh = path.join(dir, "start.sh");
  fs.writeFileSync(
    sh,
    `#!/usr/bin/env bash
cd "$(dirname "$0")"

export JAVA_BIN="\${JAVA_PATH:-java}"

if [[ -f server.pid ]] && kill -0 "$(cat server.pid)" 2>/dev/null; then
  echo "Already running (PID $(cat server.pid))"
  exit 0
fi

nohup ${runner.unix} >> logs/latest.log 2>&1 &
echo $! > server.pid
`,
    "utf8",
  );
  try {
    fs.chmodSync(sh, 0o755);
  } catch {}
  const stop = path.join(dir, "stop.sh");
  fs.writeFileSync(
    stop,
    `#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ -f server.pid ]; then
  PID="$(cat server.pid)"
  kill "$PID" 2>/dev/null || true
  sleep 2
  if kill -0 "$PID" 2>/dev/null; then kill -9 "$PID" 2>/dev/null || true; fi
  rm -f server.pid
else
  pkill -f "${runner.unix}" 2>/dev/null || true
fi
`,
    "utf8",
  );
  try {
    fs.chmodSync(stop, 0o755);
  } catch {}
  const restart = path.join(dir, "restart.sh");
  fs.writeFileSync(
    restart,
    `#!/usr/bin/env bash
cd "$(dirname "$0")"
./stop.sh || true
sleep 2
./start.sh
`,
    "utf8",
  );
  try {
    fs.chmodSync(restart, 0o755);
  } catch {}
  const bat = path.join(dir, "start.bat");
  fs.writeFileSync(
    bat,
    `@echo off
cd /d %~dp0
set "JAVA_BIN=%JAVA_PATH%"
if "%JAVA_BIN%"=="" set "JAVA_BIN=java"
call ${runner.win} >> logs\\latest.log 2>&1
`,
    "utf8",
  );
}

const DEFAULT_FLAGS = [
  "-Xms{mem}",
  "-Xmx{mem}",
  "-XX:+UseG1GC",
  "-XX:+ParallelRefProcEnabled",
  "-XX:MaxGCPauseMillis=200",
  "-XX:+UnlockExperimentalVMOptions",
  "-XX:+DisableExplicitGC",
  "-XX:+AlwaysPreTouch",
  "-XX:G1NewSizePercent=30",
  "-XX:G1MaxNewSizePercent=40",
  "-XX:G1HeapRegionSize=8M",
  "-XX:G1ReservePercent=20",
  "-XX:G1HeapWastePercent=5",
  "-XX:G1MixedGCCountTarget=4",
  "-XX:InitiatingHeapOccupancyPercent=15",
  "-XX:G1MixedGCLiveThresholdPercent=90",
  "-XX:G1RSetUpdatingPauseTimePercent=5",
  "-XX:SurvivorRatio=32",
  "-XX:+PerfDisableSharedMem",
  "-XX:MaxTenuringThreshold=1",
];

function makeScripts(dir: string, launchCmd: string, mem: string) {
  const flags = DEFAULT_FLAGS.map((f) => f.replaceAll("{mem}", mem)).join(" ");
  const cmd = `${launchCmd}`;
  ensureDir(path.join(dir, "logs"));
  const sh = path.join(dir, "start.sh");
  fs.writeFileSync(
    sh,
    `#!/usr/bin/env bash
cd "$(dirname "$0")"
JAVA_BIN="\${JAVA_PATH:-java}"
if [[ -f server.pid ]] && kill -0 "$(cat server.pid)" 2>/dev/null; then
  echo "Already running (PID $(cat server.pid))"
  exit 0
fi
nohup "$JAVA_BIN" ${flags} ${cmd} nogui >> logs/latest.log 2>&1 &
echo $! > server.pid
`,
    "utf8",
  );
  try {
    fs.chmodSync(sh, 0o755);
  } catch {}
  fs.writeFileSync(
    path.join(dir, "stop.sh"),
    `#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ -f server.pid ]; then
  PID="$(cat server.pid)"
  kill "$PID" 2>/dev/null || true
  sleep 2
  if kill -0 "$PID" 2>/dev/null; then kill -9 "$PID" 2>/dev/null || true; fi
  rm -f server.pid
else
  pkill -f "${cmd.split(" ")[0]}" 2>/dev/null || true
fi
`,
    "utf8",
  );
  try {
    fs.chmodSync(path.join(dir, "stop.sh"), 0o755);
  } catch {}
  fs.writeFileSync(
    path.join(dir, "restart.sh"),
    `#!/usr/bin/env bash
cd "$(dirname "$0")"
./stop.sh || true
sleep 2
./start.sh
`,
    "utf8",
  );
  try {
    fs.chmodSync(path.join(dir, "restart.sh"), 0o755);
  } catch {}
  const bat = path.join(dir, "start.bat");
  fs.writeFileSync(
    bat,
    `@echo off
cd /d %~dp0
set "JAVA_BIN=%JAVA_PATH%"
if "%JAVA_BIN%"=="" set "JAVA_BIN=java"
"%JAVA_BIN%" ${flags} ${cmd} nogui
echo %PROCESS_ID% > server.pid
`,
    "utf8",
  );
}

export function writeEula(dir: string, accept: boolean) {
  fs.writeFileSync(
    path.join(dir, "eula.txt"),
    `eula=${accept ? "true" : "false"}\n`,
    "utf8",
  );
}

export function writeProps(dir: string, port: string) {
  const p = path.join(dir, "server.properties");
  if (fs.existsSync(p)) return;
  fs.writeFileSync(
    p,
    [
      `server-port=${port}`,
      "gamemode=survival",
      "online-mode=true",
      "motd=Bmo's Server",
      "spawn-protection=0",
      "view-distance=10",
      "simulation-distance=10",
      "max-players=10",
      "white-list=false",
      "enable-status=true",
      "enable-rcon=true",
      `rcon.port=25575`,
      `rcon.password=${DEFAULT_RCON_PASSWORD}`,
    ].join("\n") + "\n",
    "utf8",
  );
}

/* ----------------------------- metadata fetch ---------------------------- */

async function fetchJson<T = unknown>(url: string): Promise<T> {
  const rs = await httpGet(url);
  let data = "";
  for await (const c of rs) data += c;
  return JSON.parse(data) as T;
}
async function fetchText(url: string): Promise<string> {
  const rs = await httpGet(url);
  let data = "";
  for await (const c of rs) data += c;
  return data.toString();
}

interface MojangVersionItem {
  id: string;
  type: string;
  url: string;
}
interface MojangManifest {
  latest?: { release?: string };
  versions: MojangVersionItem[];
}
interface ForgePromos {
  promos?: Record<string, string | number>;
}

async function latestVanilla(): Promise<string> {
  const m = await fetchJson<MojangManifest>(MOJANG_MANIFEST);
  return (
    m?.latest?.release ||
    m.versions.find((v) => v.type === "release")?.id ||
    "latest"
  );
}
async function vanillaServerUrl(version: string): Promise<string> {
  const manifest = await fetchJson<MojangManifest>(MOJANG_MANIFEST);
  const match = manifest.versions.find((v) => v.id === version);
  if (!match) throw new Error(`Version ${version} not found`);
  const meta = await fetchJson<{ downloads?: { server?: { url?: string } } }>(
    match.url,
  );
  const url = meta?.downloads?.server?.url;
  if (!url) throw new Error(`No server jar for ${version}`);
  return url;
}
async function fabricInstallerUrl(): Promise<string> {
  const items = await fetchJson<Array<{ version: string; stable?: boolean }>>(
    FABRIC_INSTALLER_LIST,
  );
  const stable = items.find((x) => x.stable) || items[0];
  const v = stable.version;
  return `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${v}/fabric-installer-${v}.jar`;
}
async function forgeInstallerUrl(mc: string): Promise<string> {
  const promos = await fetchJson<ForgePromos>(FORGE_PROMOS);
  const p = promos?.promos || {};
  const build = p[`${mc}-recommended`] ?? p[`${mc}-latest`];
  if (!build) throw new Error(`No Forge build for ${mc}`);
  const ver = `${mc}-${String(build)}`;
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${ver}/forge-${ver}-installer.jar`;
}
async function neoforgeInstallerUrl(
  mc: string,
): Promise<{ url: string; chosen: string }> {
  const xml = await fetchText(NEOFORGE_META);
  const versions = Array.from(xml.matchAll(/<version>([^<]+)<\/version>/g)).map(
    (m) => m[1],
  );
  if (!versions.length) throw new Error("NeoForge metadata empty");
  const parts = mc.split(".");
  const line = (parts[0] === "1" ? parts[1] : parts[0]) + ".";
  const candidates = versions.filter((v) => v.startsWith(line));
  const chosen = candidates.length
    ? candidates[candidates.length - 1]
    : versions[versions.length - 1];
  return {
    url: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${chosen}/neoforge-${chosen}-installer.jar`,
    chosen,
  };
}

/* ------------------------ optimization (Modrinth) ------------------------ */

const OPTIMIZATION_MODS: Record<Loader, string[]> = {
  fabric: [
    "lithium",
    "ferrite-core",
    "krypton",
    "c2me-fabric",
    "servercore",
    "memoryleakfix",
    "lazydfu",
  ],
  quilt: [
    "lithium",
    "ferrite-core",
    "krypton",
    "c2me-fabric",
    "servercore",
    "memoryleakfix",
    "lazydfu",
  ],
  forge: ["ferrite-core", "memoryleakfix", "lazydfu"],
  neoforge: ["ferrite-core", "memoryleakfix", "lazydfu"],
};
/* ------------------------------- installers ------------------------------ */

function runJavaInstaller(cwd: string, jarPath: string, args: string[]) {
    const r = spawnSync("java", ["-jar", jarPath, ...args], {
      cwd,
      stdio: "inherit",
    });
    if (r.status !== 0) throw new Error(`Installer failed: ${jarPath}`);
  }
  
  async function installCurseForgeServerZip(
    dir: string,
    url: string,
    onStep?: Stepper,
  ) {
    const say: Stepper = async (m) => { try { await onStep?.(m); } catch {} };
    const p = new Progress(say);
    const zipPath = path.join(dir, "cf-server-pack.zip");
  
    // ~20%: download
    p.start(0.20, "Fetching CurseForge server pack…");
    await download(url, zipPath, (r) => p.emit(r, "Downloading server pack…"));
    p.end("Downloaded server pack.");
  
    // space check (best-effort) + sanity
    const zipStat = fs.existsSync(zipPath) ? fs.statSync(zipPath) : null;
    const freeKB = diskFreeKB(dir);
    if (zipStat && freeKB && freeKB * 1024 < zipStat.size * 2.5) {
      throw new Error(
        `Not enough disk space to extract server pack. Have ~${(freeKB/1024/1024).toFixed(1)} GB, ` +
        `need at least ~${(zipStat.size*2.5/1024/1024/1024).toFixed(1)} GB.`,
      );
    }
    assertZipMagic(zipPath);
  
    // ~10%: extract (exclude client junk)
    p.start(0.10, "Extracting server pack…");
    const exclude = [
      "overrides/*", "overrides/**",
      "resourcepacks/*", "resourcepacks/**",
      "shaderpacks/*", "shaderpacks/**",
      "*.zip", "*.zip.txt", "*/*.zip", "*/*.zip.txt",
    ];
    const uz = spawnSync("unzip", ["-o", zipPath, "-d", dir, "-x", ...exclude], { stdio: "inherit" });
    if (uz.status !== 0) {
      safeRm(path.join(dir, "overrides"));
      throw new Error("Failed to unzip server pack (disk full or corrupt zip).");
    }
  
    // post-extract cleanup
    safeRm(path.join(dir, "overrides"));
    safeRm(path.join(dir, "resourcepacks"));
    safeRm(path.join(dir, "shaderpacks"));
    p.end("Server pack extracted.");
  }
  
async function modrinthLatestDownloadUrl(
  slug: string,
  mcVersion: string,
  loaders: Loader[],
): Promise<string | null> {
  const params = new URLSearchParams({
    game_versions: JSON.stringify([mcVersion]),
    loaders: JSON.stringify(loaders),
  });
  const url = `https://api.modrinth.com/v2/project/${encodeURIComponent(
    slug,
  )}/version?${params.toString()}`;

  const rs = await httpGet(url);
  let body = "";
  for await (const c of rs) body += c;
  const versions = JSON.parse(body) as Array<{
    files?: Array<{ url: string; primary?: boolean }>;
  }>;
  if (!Array.isArray(versions) || versions.length === 0) return null;
  const files = versions[0].files ?? [];
  const primary = files.find((f) => f.primary) ?? files[0];
  return primary?.url ?? null;
}

async function installOptimizations(opts: {
  dir: string;
  flavor: Flavor;
  mcVersion: string;
  say: Stepper;
}) {
  if (opts.flavor === "vanilla") return;

  const loader: Loader =
    opts.flavor === "fabric"
      ? "fabric"
      : opts.flavor === "forge"
      ? "forge"
      : opts.flavor === "neoforge"
      ? "neoforge"
      : "fabric";

  const modsDir = path.join(opts.dir, "mods");
  ensureDir(modsDir);

  await opts.say(`Adding optimization mods (${loader})…`);
  const slugs = OPTIMIZATION_MODS[loader];

  for (const slug of slugs) {
    try {
      const dl = await modrinthLatestDownloadUrl(slug, opts.mcVersion, [loader]);
      if (!dl) {
        await opts.say(`Skipping ${slug}: no compatible build found.`);
        continue;
      }
      const filename = path.basename(new URL(dl).pathname);
      const dest = path.join(modsDir, filename);
      await opts.say(`Downloading ${slug}…`);
      await download(dl, dest, (r) =>
        opts.say(`Downloading ${slug}… ${Math.round(r * 100)}%`),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await opts.say(`Failed ${slug}: ${msg}`);
    }
  }

  await opts.say("Optimization mods installed.");
}

/* --------------------------------- main ---------------------------------- */

export async function createServer(args: CreateArgs, onStep?: Stepper) {
  const say: Stepper = async (m: string) => {
    try {
      await onStep?.(m);
    } catch {}
  };
  const p = new Progress(say);

  const serverDir = P.server(args.name);
  ensureDir(serverDir);
  ensureDir(path.join(serverDir, "logs"));

  p.start(0.05, `Preparing “${args.name}”…`);
  const ver =
    args.version?.toLowerCase() === "latest" ? await latestVanilla() : args.version;
  writeProps(serverDir, args.port);
  writeEula(serverDir, !!args.eula);
  p.end(`Using Minecraft ${ver}.`);

  if (args.curseforgeServerZipUrl) {
    await installCurseForgeServerZip(
      serverDir,
      args.curseforgeServerZipUrl,
      onStep,
    );
  }

  if (args.flavor === "vanilla") {
    const url = await vanillaServerUrl(ver);
    const jar = path.join(serverDir, "server.jar");
    p.start(0.35, "Downloading vanilla server…");
    await download(url, jar, (r) => p.emit(r, "Downloading vanilla server…"));
    p.end("Vanilla server downloaded.");
    p.start(0.1, "Creating launch scripts…");
    makeScripts(serverDir, `-jar server.jar`, args.memory);
    p.end("Launch scripts ready.");
  } else if (args.flavor === "fabric") {
    const inst = await fabricInstallerUrl();
    const instJar = path.join(serverDir, "fabric-installer.jar");
    p.start(0.1, "Fetching Fabric installer…");
    await download(inst, instJar, (r) => p.emit(r, "Fetching Fabric installer…"));
    p.end("Fabric installer ready.");
    p.start(0.25, "Running Fabric installer…");
    runJavaInstaller(serverDir, instJar, [
      "server",
      "-mcversion",
      ver,
      "-downloadMinecraft",
    ]);
    p.end("Fabric installed.");
    p.start(0.1, "Creating launch scripts…");
    const launch = fs.existsSync(path.join(serverDir, "fabric-server-launch.jar"))
      ? "fabric-server-launch.jar"
      : "server.jar";
    makeScripts(serverDir, `-jar ${launch}`, args.memory);
    p.end("Launch scripts ready.");

    if (args.optimize) {
      p.start(0.1, "Installing optimization mods…");
      await installOptimizations({ dir: serverDir, flavor: "fabric", mcVersion: ver, say });
      p.end("Optimization mods installed.");
    }
  } else if (args.flavor === "forge") {
    const inst = await forgeInstallerUrl(ver);
    const instJar = path.join(serverDir, "forge-installer.jar");
    p.start(0.1, "Fetching Forge installer…");
    await download(inst, instJar, (r) => p.emit(r, "Fetching Forge installer…"));
    p.end("Forge installer ready.");
    p.start(0.25, "Running Forge installer…");
    runJavaInstaller(serverDir, instJar, ["--installServer"]);
    p.end("Forge installed.");
    p.start(0.1, "Creating launch scripts…");
    const runSh = path.join(serverDir, "run.sh");
    const runBat = path.join(serverDir, "run.bat");
    if (fs.existsSync(runSh) || fs.existsSync(runBat)) {
      makeScriptsInvokeRunner(serverDir, { unix: "./run.sh", win: "run.bat" });
    } else {
      const jar =
        fs
          .readdirSync(serverDir)
          .find(
            (f) =>
              f.startsWith("forge-") &&
              f.endsWith(".jar") &&
              !f.includes("installer"),
          ) || "server.jar";
      makeScripts(serverDir, `-jar ${jar}`, args.memory);
    }
    p.end("Launch scripts ready.");

    if (args.optimize) {
      p.start(0.1, "Installing optimization mods…");
      await installOptimizations({ dir: serverDir, flavor: "forge", mcVersion: ver, say });
      p.end("Optimization mods installed.");
    }
  } else if (args.flavor === "neoforge") {
    const { url } = await neoforgeInstallerUrl(ver);
    const instJar = path.join(serverDir, "neoforge-installer.jar");
    p.start(0.1, "Fetching NeoForge installer…");
    await download(url, instJar, (r) => p.emit(r, "Fetching NeoForge installer…"));
    p.end("NeoForge installer ready.");
    p.start(0.25, "Running NeoForge installer…");
    runJavaInstaller(serverDir, instJar, ["--installServer"]);
    p.end("NeoForge installed.");
    p.start(0.1, "Creating launch scripts…");
    const runSh = path.join(serverDir, "run.sh");
    const runBat = path.join(serverDir, "run.bat");
    if (fs.existsSync(runSh) || fs.existsSync(runBat)) {
      makeScriptsInvokeRunner(serverDir, { unix: "./run.sh", win: "run.bat" });
    } else {
      const jar =
        fs
          .readdirSync(serverDir)
          .find(
            (f) =>
              f.startsWith("neoforge-") &&
              f.endsWith(".jar") &&
              !f.includes("installer"),
          ) || "server.jar";
      makeScripts(serverDir, `-jar ${jar}`, args.memory);
    }
    p.end("Launch scripts ready.");

    if (args.optimize) {
      p.start(0.1, "Installing optimization mods…");
      await installOptimizations({ dir: serverDir, flavor: "neoforge", mcVersion: ver, say });
      p.end("Optimization mods installed.");
    }
  } else {
    throw new Error(`Unknown flavor: ${args.flavor}`);
  }

  p.start(1, "Finalizing…");
  p.end("Finished setup.");

  return { dir: serverDir, version: ver };
}
