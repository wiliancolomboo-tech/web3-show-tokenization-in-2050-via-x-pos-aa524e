import { Keypair, PublicKey } from "@solana/web3.js";
import { TelemetryOracleAgent } from "./telemetry_oracle";
import * as crypto from "crypto";

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
  const programId = new PublicKey(
    process.env.PROGRAM_ID || "HeLioS1111111111111111111111111111111111111"
  );

  // Authority Keypair derivation
  const authority = Keypair.generate();
  console.log(`Starting HelioStream 2050 Daemon. Telemetry Authority: ${authority.publicKey.toBase58()}`);

  const oracle = new TelemetryOracleAgent(rpcUrl, authority, programId);
  const swarmId = crypto.randomBytes(16);

  console.log(`Configuring Orbital Sensor ID: 0x${swarmId.toString("hex")}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal Daemon Error:", err);
    process.exit(1);
  });
}