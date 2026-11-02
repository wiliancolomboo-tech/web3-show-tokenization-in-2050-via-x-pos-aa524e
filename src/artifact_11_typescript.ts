import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Helios2050 } from "../target/types/helios_2050";
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAccount,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";

describe("helios-2050 integration tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Helios2050 as Program<Helios2050>;
  
  const authority = Keypair.generate();
  const telemetryOracle = Keypair.generate();
  let mintPubkey: PublicKey;
  let recipientAta: PublicKey;
  let collectorPda: PublicKey;
  let collectorBump: number;

  const orbitalRegistryId = new Array(32).fill(0);
  // ASCII for 'DYSON-SWARM-01'
  const nameBytes = Buffer.from("DYSON-SWARM-01");
  nameBytes.copy(Buffer.from(orbitalRegistryId), 0);

  before(async () => {
    // Airdrop funds to authority and telemetry oracle
    const airdropAuth = await provider.connection.requestAirdrop(authority.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropAuth);

    const airdropOracle = await provider.connection.requestAirdrop(telemetryOracle.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropOracle);

    [collectorPda, collectorBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("helios_collector"), Buffer.from(orbitalRegistryId)],
      program.programId
    );

    // Create Token-2022 Mint with collectorPda as mint authority
    mintPubkey = await createMint(
      provider.connection,
      authority,
      collectorPda,
      null,
      6,
      Keypair.generate(),
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create Recipient Token-2022 Account
    recipientAta = await createAccount(
      provider.connection,
      authority,
      mintPubkey,
      authority.publicKey,
      Keypair.generate(),
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("1. Successfully initializes an Orbital Photovoltaic Collector PDA", async () => {
    const nominalCapacityMw = new anchor.BN(5000); // 5 GW
    const annualDegradationBps = 75; // 0.75% per year

    await program.methods
      .initializeCollector(orbitalRegistryId, nominalCapacityMw, annualDegradationBps)
      .accounts({
        authority: authority.publicKey,
        telemetryOracle: telemetryOracle.publicKey,
        mint: mintPubkey,
        collector: collectorPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const collectorAccount = await program.account.orbitalCollector.fetch(collectorPda);
    expect(collectorAccount.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(collectorAccount.telemetryOracle.toBase58()).to.equal(telemetryOracle.publicKey.toBase58());
    expect(collectorAccount.nominalCapacityMw.toNumber()).to.equal(5000);
    expect(collectorAccount.status).to.equal(1); // Active
  });

  it("2. Accurately ingests telemetry and mints Token-2022 yield", async () => {
    // Advance clock simulation by submitting forward telemetry
    const now = Math.floor(Date.now() / 1000) + 10;
    const instantaneousMw = new anchor.BN(4800);
    const efficiencyBps = 9900; // 99%

    await program.methods
      .recordTelemetryAndMint(instantaneousMw, efficiencyBps, new anchor.BN(now))
      .accounts({
        collector: collectorPda,
        telemetryOracle: telemetryOracle.publicKey,
        mint: mintPubkey,
        recipientTokenAccount: recipientAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([telemetryOracle])
      .rpc();

    const recipientAccount = await getAccount(
      provider.connection,
      recipientAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    expect(Number(recipientAccount.amount)).to.be.greaterThan(0);
    console.log(`[TEST ASSERTION PASSED] Minted ${recipientAccount.amount} micro-units of energy.`);
  });

  it("3. Rejects telemetry submission from an unauthorized oracle", async () => {
    const rogueOracle = Keypair.generate();
    const airdropRogue = await provider.connection.requestAirdrop(rogueOracle.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropRogue);

    const now = Math.floor(Date.now() / 1000) + 20;

    try {
      await program.methods
        .recordTelemetryAndMint(new anchor.BN(4800), 9900, new anchor.BN(now))
        .accounts({
          collector: collectorPda,
          telemetryOracle: rogueOracle.publicKey,
          mint: mintPubkey,
          recipientTokenAccount: recipientAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([rogueOracle])
        .rpc();
      expect.fail("Should have thrown unauthorized oracle error");
    } catch (err: any) {
      expect(err.error?.errorCode?.code || err.message).to.include("UnauthorizedTelemetryOracle");
    }
  });

  it("4. Prevents stale or backdated telemetry ingestion", async () => {
    // Replay stale timestamp
    const staleTimestamp = new anchor.BN(100);

    try {
      await program.methods
        .recordTelemetryAndMint(new anchor.BN(4800), 9900, staleTimestamp)
        .accounts({
          collector: collectorPda,
          telemetryOracle: telemetryOracle.publicKey,
          mint: mintPubkey,
          recipientTokenAccount: recipientAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([telemetryOracle])
        .rpc();
      expect.fail("Should have rejected stale timestamp");
    } catch (err: any) {
      expect(err.error?.errorCode?.code || err.message).to.include("StaleTelemetryTimestamp");
    }
  });

  it("5. Transfer Hook executes constraint checks", async () => {
    // Executes transfer hook interface directly
    const tx = await program.methods
      .executeTransferHook(new anchor.BN(50_000))
      .accounts({
        sourceAccount: recipientAta,
        mint: mintPubkey,
        destinationAccount: recipientAta,
        ownerDelegate: authority.publicKey,
        extraAccountMetas: collectorPda,
      })
      .rpc();

    expect(tx).to.be.a("string");
  });
});