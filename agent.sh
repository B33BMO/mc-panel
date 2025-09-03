#!/usr/bin/env bash
set -euo pipefail

# ========= configurable defaults =========
AGENT_DIR="/opt/mc-agent"
AGENT_PORT="${AGENT_PORT:-8787}"
SERVERS_ROOT_DEFAULT="/home/minecraft/servers"   # <- change if you like
AGENT_TOKEN_DEFAULT="superlonglocaltoken"        # <- change
NODE_BIN="${NODE_BIN:-/usr/bin/node}"            # will install Node 20 if missing
# =========================================

echo "== MC Agent setup =="
read -rp "Servers root directory [${SERVERS_ROOT_DEFAULT}]: " SR
SERVERS_ROOT="${SR:-$SERVERS_ROOT_DEFAULT}"

read -rp "Agent token [${AGENT_TOKEN_DEFAULT}]: " TK
AGENT_TOKEN="${TK:-$AGENT_TOKEN_DEFAULT}"

echo "Using:"
echo "  AGENT_DIR    : ${AGENT_DIR}"
echo "  SERVERS_ROOT : ${SERVERS_ROOT}"
echo "  AGENT_PORT   : ${AGENT_PORT}"
echo "  AGENT_TOKEN  : ${AGENT_TOKEN}"
echo

sudo mkdir -p "${AGENT_DIR}"
sudo chown -R "$USER":"$USER" "${AGENT_DIR}"

# --- Node install (Debian/Ubuntu) if needed ---
if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js 20 (Debian/Ubuntu assumed)…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# double-check we can run node
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not installed. Install Node 18/20+ and re-run."
  exit 1
fi

# --- project skeleton ---
cat > "${AGENT_DIR}/package.json" <<'JSON'
{
  "name": "mc-agent",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2"
  }
}
JSON

mkdir -p "${AGENT_DIR}/lib"

# server.js implements the LAN API and calls into ./lib/servers.js + ./lib/installers.js
cat > "${AGENT_DIR}/server.js" <<'JS'
import express from "express";
import cors from "cors";

// Try to import your existing logic from ./lib/*.js (you'll copy them in later)
let serversLib, installersLib;
try {
  serversLib = await import("./lib/servers.js");
} catch (e) {
  console.error("Missing ./lib/servers.js — copy your compiled servers lib here.");
}
try {
  installersLib = await import("./lib/installers.js");
} catch (e) {
  console.error("Missing ./lib/installers.js — copy your compiled installers lib here.");
}

const app = express();
app.use(express.json());
app.use(cors({ origin: true }));

const TOKEN = process.env.AGENT_TOKEN || "superlonglocaltoken";
app.use((req, res, next) => {
  const hdr = req.get("x-agent-token");
  if (!hdr || hdr !== TOKEN) return res.status(401).json({ error: "unauthorized" });
  next();
});

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// List servers
app.get("/api/servers", async (_req, res) => {
  if (!serversLib?.serversList) return res.status(501).json({ error: "serversList not available" });
  try {
    const out = await serversLib.serversList();
    res.json(out);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Stats
app.get("/api/servers/:name/stats", async (req, res) => {
  if (!serversLib?.stats) return res.status(501).json({ error: "stats not available" });
  try {
    const out = await serversLib.stats(req.params.name);
    res.json(out);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Start/Stop/Restart
for (const action of ["start","stop","restart"]) {
  app.post(`/api/servers/:name/${action}`, async (req, res) => {
    const fn = serversLib?.[`${action}Server`];
    if (!fn) return res.status(501).json({ error: `${action}Server not available` });
    try { await fn(req.params.name); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: String(e) }); }
  });
}

// Tail log via SSE
app.get("/api/servers/:name/log", async (req, res) => {
  if (!serversLib?.tailLog) return res.status(501).json({ error: "tailLog not available" });
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  const stop = serversLib.tailLog(req.params.name, (line) => res.write(`data: ${line}\n\n`));
  req.on("close", stop);
});

// Create server via SSE
app.post("/api/servers/create", async (req, res) => {
  if (!installersLib?.createServer) return res.status(501).write("data: ERROR createServer not available\n\n");
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  const onStep = (m) => res.write(`data: ${m}\n\n`);
  try {
    const out = await installersLib.createServer(req.body, onStep);
    res.write(`data: DONE ${JSON.stringify(out)}\n\n`);
  } catch (e) {
    res.write(`data: ERROR ${e?.message || String(e)}\n\n`);
  } finally { res.end(); }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, "0.0.0.0", () => console.log("mc-agent listening on", port));
JS

# .env (optional – service sets these too)
cat > "${AGENT_DIR}/.env.example" <<EOF
SERVERS_ROOT=${SERVERS_ROOT}
AGENT_TOKEN=${AGENT_TOKEN}
PORT=${AGENT_PORT}
RCON_PASSWORD=changeme123
EOF

# install deps
(cd "${AGENT_DIR}" && npm install --omit=dev)

# systemd unit
sudo tee /etc/systemd/system/mc-agent.service >/dev/null <<EOF
[Unit]
Description=Minecraft Agent (local API)
After=network.target

[Service]
WorkingDirectory=${AGENT_DIR}
Environment=NODE_ENV=production
Environment=PORT=${AGENT_PORT}
Environment=SERVERS_ROOT=${SERVERS_ROOT}
Environment=AGENT_TOKEN=${AGENT_TOKEN}
# Optional: pass your RCON password so installers write it
Environment=RCON_PASSWORD=changeme123
ExecStart=/usr/bin/env node --max-old-space-size=128 server.js
Restart=always
RestartSec=2
MemoryMax=256M
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${SERVERS_ROOT} ${AGENT_DIR}

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload

echo
echo "== IMPORTANT STEP =="
echo "Copy your compiled libs into ${AGENT_DIR}/lib:"
echo "  - servers.js (compiled from your Next app's src/lib/servers.ts)"
echo "  - installers.js (compiled from your Next app's src/lib/installers.ts)"
echo
echo "If you don't have compiled JS, you can also copy the TS files and build them here,"
echo "but the simplest way is to export the JS from your panel build output."
echo

read -rp "Press ENTER once you've copied lib/*.js (or press Ctrl+C to abort)…"

sudo systemctl enable --now mc-agent
sleep 1
sudo systemctl status --no-pager mc-agent || true

echo
echo "Done. Test from your panel box (replace IP if needed):"
echo "  curl -H 'x-agent-token: ${AGENT_TOKEN}' http://192.168.1.56:${AGENT_PORT}/api/health"
