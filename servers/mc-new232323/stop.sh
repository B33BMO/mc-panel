#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ -f server.pid ]; then
  PID="$(cat server.pid)"
  kill "$PID" 2>/dev/null || true
  sleep 2
  if kill -0 "$PID" 2>/dev/null; then kill -9 "$PID" 2>/dev/null || true; fi
  rm -f server.pid
else
  pkill -f "-jar" 2>/dev/null || true
fi
