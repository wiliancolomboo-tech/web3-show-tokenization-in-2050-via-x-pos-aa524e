import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import axios from "axios";
import { Resend } from "resend";
import * as crypto from "crypto";

export interface TelemetryPacket {
  assetId: Buffer;
  mwhHarvested: number;
  efficiencyBps: number;
  timestamp: number;
}

export class AetherOrchestrator {
  private program: Program;
  private oracleKeypair: web3.Keypair;
  private resendClient: Resend | null;
  private alertWebhookUrl: string | null;

  constructor(
    program: Program,
    oracleKeypair: web3.Keypair,
    resendApiKey?: string,
    alertWebhookUrl?: string
  ) {
    this.program = program;
    this.oracleKeypair = oracleKeypair;
    this.resendClient = resendApiKey ? new Resend(resendApiKey) : null;
    this.alertWebhookUrl = alertWebhookUrl || null;
  }

  /**
   * Derive the deterministic Asset Registry PDA
   */
  public getAssetPDA(assetId: Buffer): [web3.PublicKey, number] {
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from("aether_asset"), assetId],
      this.program.programId
    );
  }

  /**
   * Submit physical telemetry on-chain and trigger enterprise notification streams
   */
  public async submitTelemetry(packet: TelemetryPacket): Promise<string> {
    const [assetPda] = this.getAssetPDA(packet.assetId);

    console.log(
      `[ORBITAL TELEMETRY] Ingesting Array: 0x${packet.assetId.toString("hex")} | Generation: ${packet.mwhHarvested} MWh`
    );

    // 1. Dispatch Solana Smart Contract Transaction
    const tx = await (this.program.methods as any)
      .ingestTelemetry(
        new anchor.BN(packet.mwhHarvested),
        packet.efficiencyBps,
        new anchor.BN(packet.timestamp)
      )
      .accounts({
        assetAccount: assetPda,
        oracleSigner: this.oracleKeypair.publicKey,
      })
      .signers([this.oracleKeypair])
      .rpc();

    console.log(`[SOLANA CONFIRMED] TX Signature: ${tx}`);

    // 2. Off-Chain Enterprise Dispatches
    await this.dispatchEnterpriseNotifications(tx, packet);

    return tx;
  }

  /**
   * Enterprise Multi-Channel Dispatch (Resend + Slack/Discord)
   */
  private async dispatchEnterpriseNotifications(
    txSig: string,
    packet: TelemetryPacket
  ): Promise<void> {
    const assetHex = packet.assetId.toString("hex");
    const summary = `Orbital Ingestion Confirmed: Array 0x${assetHex} harvested ${packet.mwhHarvested} MWh at ${packet.efficiencyBps / 100}% solar capture efficiency.`;

    // A. Webhook Dispatch (Slack / Discord)
    if (this.alertWebhookUrl) {
      try {
        await axios.post(this.alertWebhookUrl, {
          username: "AETHER-2050 Orbital SecOps",
          content: `🛰️ **[SOLANA 2050 TOKENIZATION AUDIT]**\n${summary}\nExplorer: https://explorer.solana.com/tx/${txSig}?cluster=custom`,
        });
        console.log("[ENTERPRISE] Webhook notification dispatched.");
      } catch (err: any) {
        console.error(`[ENTERPRISE WARNING] Webhook post failed: ${err.message}`);
      }
    }

    // B. Resend Email Dispatch (Institutional Custodian Audit)
    if (this.resendClient && process.env.AUDIT_EMAIL_RECIPIENT) {
      try {
        await this.resendClient.emails.send({
          from: "audits@aether2050.network",
          to: process.env.AUDIT_EMAIL_RECIPIENT,
          subject: `[PROOF OF GENERATION] Asset 0x${assetHex.slice(0, 8)} MWh Tranche Cleared`,
          html: `
            <h2>AETHER-2050 Energy Tokenization Telemetry Receipt</h2>
            <p><strong>Solana Transaction:</strong> <code>${txSig}</code></p>
            <p><strong>Harvested Output:</strong> ${packet.mwhHarvested} MWh</p>
            <p><strong>Efficiency:</strong> ${packet.efficiencyBps / 100}%</p>
            <p><strong>Timestamp:</strong> ${new Date(packet.timestamp * 1000).toISOString()}</p>
            <hr />
            <p>Verified cryptographically by Orbital Autonomous Signer node.</p>
          `,
        });
        console.log("[ENTERPRISE] Institutional verification email delivered via Resend.");
      } catch (err: any) {
        console.error(`[ENTERPRISE WARNING] Resend dispatch failed: ${err.message}`);
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Standalone CLI Runner Loop
// -----------------------------------------------------------------------------
async function runDaemon() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = await Program.fetchIdl(
    new web3.PublicKey("AEThER2o5o111111111111111111111111111111111"),
    provider
  );

  if (!idl) {
    throw new Error("AETHER-2050 IDL not located on current cluster.");
  }

  const program = new Program(idl, provider);
  const oracleKey = (provider.wallet as anchor.Wallet).payer;

  const orchestrator = new AetherOrchestrator(
    program,
    oracleKey,
    process.env.RESEND_API_KEY,
    process.env.ENTERPRISE_WEBHOOK_URL
  );

  // Deterministic 16-byte Asset ID for Orbital Array Alpha
  const assetId = Buffer.from(crypto.createHash("sha256").update("DYSON_ARRAY_ALPHA").digest().subarray(0, 16));

  console.log("Starting AETHER-2050 Autonomous Telemetry Stream...");

  // Send periodic telemetry packet
  const packet: TelemetryPacket = {
    assetId,
    mwhHarvested: 1450,
    efficiencyBps: 9850,
    timestamp: Math.floor(Date.now() / 1000),
  };

  await orchestrator.submitTelemetry(packet);
}

if (require.main === module) {
  runDaemon().catch((err) => {
    console.error("Daemon encountered fatal exception:", err);
    process.exit(1);
  });
}