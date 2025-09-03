#!/usr/bin/env bash
cd "$(dirname "$0")"
./stop.sh || true
sleep 2
./start.sh
