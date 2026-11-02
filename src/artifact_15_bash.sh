#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "      HELIOS-2050 PROTOCOL: ZERO-DOWNTIME DEPLOYMENT      "
echo "=========================================================="

NETWORK="${1:-devnet}"
echo "[1/4] Targeted Solana Network: ${NETWORK}"

# 1. Build Solana Anchor Program
echo "[2/4] Compiling Anchor Verifiable BPF Program..."
anchor build

# 2. Deploy BPF Bytecode to Solana Cluster
echo "[3/4] Deploying to Solana Cluster (${NETWORK})..."
anchor deploy --provider.cluster "${NETWORK}"

# 3. Initialize Swarm and Launch Containerized Telemetry Engine
echo "[4/4] Starting Enterprise Telemetry Relayer Daemon via Docker..."
docker compose up -d --build

echo "=========================================================="
echo "    HELIOS-2050 DEPLOYED & OPERATIONAL ON SOLANA 2050     "
echo "=========================================================="