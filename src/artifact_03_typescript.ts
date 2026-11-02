import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
} from "@solana/spl-token";
import axios from "axios";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

// Configuration environment variables
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const ENTERPRISE_ALERT_EMAIL = process.env.ENTERPRISE_ALERT_EMAIL || "sovereign-desk@aether2050.io";

export class AetherOrchestrator {
  private connection: Connection;
  private relayerKeypair: Keypair;
  private hardwareKeypair: Keypair;
  private programId: PublicKey;

  constructor(
    relayerKeypair: Keypair,
    hardwareKeypair: Keypair,
    programId: PublicKey
  ) {
    this.connection = new Connection(RPC_URL, "confirmed");
    this.relayerKeypair = relayerKeypair;
    this.hardwareKeypair = hardwareKeypair;
    this.programId = programId;
  }

  /**
   * Dispatches institutional notifications to Discord Webhook and Resend API
   */
  public async notifyInstitutionalChannels(params: {
    assetId: string;
    energyHarvestedKwh: number;
    efficiencyBps: number;
    yieldDistributedTokens: number;
    txSignature: string;
  }): Promise<void> {
    const { assetId, energyHarvestedKwh, efficiencyBps, yieldDistributedTokens, txSignature } = params;
    const efficiencyPct = (efficiencyBps / 100).toFixed(2);

    // 1. Dispatch Discord Alert
    if (DISCORD_WEBHOOK_URL) {
      try {
        await axios.post(DISCORD_WEBHOOK_URL, {
          username: "AETHER-2050 Telemetry Node",
          avatar_url: "https://solana.com/src/img/branding/solanaLogoMark.png",
          embeds: [
            {
              title: `⚡ Physical Asset Yield Streaming Epoch: ${assetId}`,
              color: efficiencyBps > 5000 ? 0x00ffa3 : 0xff3b30,
              fields: [
                { name: "Asset ID", value: `\`${assetId}\``, inline: true },
                { name: "Harvested Energy", value: `${energyHarvestedKwh.toLocaleString()} kWh`, inline: true },
                { name: "Hardware Efficiency", value: `${efficiencyPct}%`, inline: true },
                { name: "Yield Distributed", value: `${yieldDistributedTokens} AETH`, inline: true },
                { name: "Solana Transaction", value: `[View on Explorer](https://explorer.solana.com/tx/${txSignature}?cluster=devnet)`, inline: false },
              ],
              footer: { text: "Autonomous Cyber-Physical Attestation • Solana 2050" },
              timestamp: new Date().toISOString(),
            },
          ],
        });
        console.log(`[DISCORD] Successfully notified enterprise channel.`);
      } catch (err: any) {
        console.error(`[DISCORD_ERROR] Webhook delivery failed: ${err.message}`);
      }
    }

    // 2. Dispatch Enterprise Dividend Summary via Resend
    if (RESEND_API_KEY) {
      try {
        await axios.post(
          "https://api.resend.com/emails",
          {
            from: "telemetry@aether2050.io",
            to: ENTERPRISE_ALERT_EMAIL,
            subject: `[SOLANA-2050] Yield Distributed: ${assetId} (+${yieldDistributedTokens} AETH)`,
            html: `
              <h2>AETHER-2050 Autonomous Asset Attestation</h2>
              <p>Hardware unit <strong>${assetId}</strong> published a verified cryptographic telemetry report.</p>
              <ul>
                <li><strong>Energy Produced:</strong> ${energyHarvestedKwh.toLocaleString()} kWh</li>
                <li><strong>Current Efficiency:</strong> ${efficiencyPct}%</li>
                <li><strong>Yield Streamed:</strong> ${yieldDistributedTokens} AETH-YIELD</li>
                <li><strong>Solana Tx:</strong> <code>${txSignature}</code></li>
              </ul>
              <p><em>Zero-human verification guaranteed by Solana Token-2022 and Enclave HSM.</em></p>
            `,
          },
          {
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log(`[RESEND] Enterprise dividend alert delivered to ${ENTERPRISE_ALERT_EMAIL}`);
      } catch (err: any) {
        console.error(`[RESEND_ERROR] Email delivery failed: ${err.message}`);
      }
    }
  }

  /**
   * Computes Asset Registry and Yield Vault PDAs
   */
  public getAssetPdas(assetId: string) {
    const [assetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("asset_registry"), Buffer.from(assetId)],
      this.programId
    );
    const [yieldVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("yield_vault"), Buffer.from(assetId)],
      this.programId
    );
    return { assetPda, yieldVaultPda };
  }

  /**
   * Main Ingestion Loop Simulator for Space Solar Array #771
   */
  public async executeTelemetryHeartbeat(
    program: Program<any>,
    assetId: string,
    yieldMint: PublicKey,
    investorAta: PublicKey,
    energyKwh: number,
    efficiencyBps: number
  ): Promise<string> {
    const { assetPda, yieldVaultPda } = this.getAssetPdas(assetId);

    // Simulated 64-byte Ed25519 hardware signature from HSM
    const simulatedHardwareSignature = new Uint8Array(64);
    simulatedHardwareSignature.fill(0x42);

    console.log(`\n>>> [ORBITAL TELEMETRY] Broadcasting from satellite enclave: ${this.hardwareKeypair.publicKey.toBase58()}`);

    const tx = await program.methods
      .recordTelemetryAndStreamYield(
        new anchor.BN(energyKwh),
        efficiencyBps,
        Array.from(simulatedHardwareSignature)
      )
      .accounts({
        telemetrySigner: this.hardwareKeypair.publicKey,
        assetAccount: assetPda,
        yieldMint: yieldMint,
        yieldVault: yieldVaultPda,
        investorRecipient: investorAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([this.hardwareKeypair])
      .rpc();

    console.log(`>>> [SOLANA SETTLED] Blockhash confirmed: ${tx}`);

    // Trigger enterprise webhook/email pipelines
    await this.notifyInstitutionalChannels({
      assetId,
      energyHarvestedKwh: energyKwh,
      efficiencyBps,
      yieldDistributedTokens: (energyKwh * (efficiencyBps / 10000)),
      txSignature: tx,
    });

    return tx;
  }
}