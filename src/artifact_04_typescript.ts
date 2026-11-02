import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import axios from "axios";
import { Resend } from "resend";

// Interfaces
interface TelemetryPayload {
  gridId: string;
  megawattHours: number;
  satelliteId: string;
  timestamp: number;
  fluxDensityWPerM2: number;
}

export class ChronoGridEnterpriseWorker {
  private connection: Connection;
  private authorityKeypair: Keypair;
  private oracleKeypair: Keypair;
  private resendClient: Resend | null = null;
  private webhookUrl: string | null = null;

  constructor(
    rpcUrl: string,
    authoritySecret: Uint8Array,
    oracleSecret: Uint8Array,
    resendApiKey?: string,
    webhookUrl?: string
  ) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.authorityKeypair = Keypair.fromSecretKey(authoritySecret);
    this.oracleKeypair = Keypair.fromSecretKey(oracleSecret);

    if (resendApiKey) {
      this.resendClient = new Resend(resendApiKey);
    }
    if (webhookUrl) {
      this.webhookUrl = webhookUrl;
    }
  }

  public getGridPda(programId: PublicKey, gridId: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("grid_state"), Buffer.from(gridId)],
      programId
    );
  }

  /**
   * Broadcasts enterprise mission-critical alert to Discord/Slack & Resend
   */
  public async notifyEnterpriseChannels(
    title: string,
    details: Record<string, unknown>
  ): Promise<void> {
    console.log(`[ENTERPRISE NOTIFIER] Dispatching: ${title}`);

    // 1. Webhook Notification
    if (this.webhookUrl) {
      try {
        await axios.post(this.webhookUrl, {
          content: `🛰️ **[2050 Planetary Grid Telemetry Event]**\n**${title}**\n\`\`\`json\n${JSON.stringify(
            details,
            null,
            2
          )}\n\`\`\``,
        });
      } catch (err: any) {
        console.error(`Webhook push failed: ${err.message}`);
      }
    }

    // 2. Resend Email Alert
    if (this.resendClient) {
      try {
        await this.resendClient.emails.send({
          from: "chronogrid@solana-planetary.net",
          to: "operations-lead@solana-planetary.net",
          subject: `CRITICAL TELEMETRY: ${title}`,
          html: `<h2>Planetary Tokenization Grid 2050 Alert</h2><pre>${JSON.stringify(
            details,
            null,
            2
          )}</pre>`,
        });
      } catch (err: any) {
        console.error(`Resend email push failed: ${err.message}`);
      }
    }
  }

  /**
   * Ingests validated satellite telemetry and invokes on-chain Anchor tokenization
   */
  public async processTelemetryBatch(
    program: Program<any>,
    payload: TelemetryPayload,
    mintAddress: PublicKey,
    recipientTokenAccount: PublicKey
  ): Promise<string> {
    const [gridPda] = this.getGridPda(program.programId, payload.gridId);

    console.log(`Processing telemetry from satellite: ${payload.satelliteId}`);
    console.log(`Generating ${payload.megawattHours} MWh yield on grid: ${payload.gridId}`);

    const txSignature = await program.methods
      .recordEnergyYield(
        new anchor.BN(payload.megawattHours),
        new anchor.BN(payload.timestamp)
      )
      .accounts({
        gridState: gridPda,
        energyMint: mintAddress,
        recipientTokenAccount: recipientTokenAccount,
        oracleSigner: this.oracleKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([this.oracleKeypair])
      .rpc();

    console.log(`✅ On-chain transaction confirmed: ${txSignature}`);

    // Push notification to monitoring stack
    await this.notifyEnterpriseChannels("Orbital Energy Yield Tokenized", {
      gridId: payload.gridId,
      mwh: payload.megawattHours,
      txSignature,
      satelliteId: payload.satelliteId,
      timestamp: new Date(payload.timestamp * 1000).toISOString(),
    });

    return txSignature;
  }
}