import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Heliostream } from "../target/types/heliostream";
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
import { assert, expect } from "chai";
import * as crypto from "crypto";

describe("HelioStream 2050 Protocol Test Matrix", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Heliostream as Program<Heliostream>;

  let adminKeypair = Keypair.generate();
  let telemetrySigner = Keypair.generate();
  let receiverOwner = Keypair.generate();
  let computeDatacenter = Keypair.generate();

  let tokenMint: PublicKey;
  let receiverTokenAccount: PublicKey;
  let datacenterTokenAccount: PublicKey;

  let configPda: PublicKey;
  let configBump: number;

  const swarmId = crypto.randomBytes(16);
  let swarmPda: PublicKey;
  let swarmBump: number;

  before(async () => {
    // Airdrop SOL to test actors
    const airdropSignatures = await Promise.all([
      provider.connection.requestAirdrop(adminKeypair.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(telemetrySigner.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(receiverOwner.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(computeDatacenter.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
    ]);
    for (const sig of airdropSignatures) {
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction({
        signature: sig,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      });
    }

    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("helio_protocol_config")],
      program.programId
    );

    [swarmPda, swarmBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("helio_swarm_registry"), swarmId],
      program.programId
    );

    // Create Token-2022 Mint with configPda as Mint Authority
    tokenMint = await createMint(
      provider.connection,
      adminKeypair,
      configPda,
      null,
      6,
      Keypair.generate(),
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    receiverTokenAccount = await createAccount(
      provider.connection,
      receiverOwner,
      tokenMint,
      receiverOwner.publicKey,
      Keypair.generate(),
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    datacenterTokenAccount = await createAccount(
      provider.connection,
      computeDatacenter,
      tokenMint,
      computeDatacenter.publicKey,
      Keypair.generate(),
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("1. Initializes HelioStream 2050 Global Protocol State", async () => {
    await program.methods
      .initialize()
      .accounts({
        config: configPda,
        tokenMint: tokenMint,
        telemetrySigner: telemetrySigner.publicKey,
        admin: adminKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([adminKeypair])
      .rpc();

    const configAccount = await program.account.protocolConfig.fetch(configPda);
    assert.equal(configAccount.authority.toBase58(), adminKeypair.publicKey.toBase58());
    assert.equal(configAccount.telemetrySigner.toBase58(), telemetrySigner.publicKey.toBase58());
    assert.equal(configAccount.totalSwarmsRegistered.toNumber(), 0);
  });

  it("2. Registers an Orbital Dyson Swarm Collector Unit (Lagrange-1)", async () => {
    const baseOutputMwh = new anchor.BN(50000);
    const sectorL1 = 0; // 0 = L1 Orbit

    await program.methods
      .registerSwarm(Array.from(swarmId), sectorL1, baseOutputMwh)
      .accounts({
        config: configPda,
        swarmUnit: swarmPda,
        receiverStation: receiverOwner.publicKey,
        authority: adminKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([adminKeypair])
      .rpc();

    const swarmAccount = await program.account.swarmUnit.fetch(swarmPda);
    expect(Buffer.from(swarmAccount.swarmId).toString("hex")).to.equal(swarmId.toString("hex"));
    assert.equal(swarmAccount.orbitalSector, 0);
    assert.isTrue(swarmAccount.isActive);
  });

  it("3. Attests Energy Yield with Off-Chain Cryptographic Telemetry and Mints HWT", async () => {
    const irradianceJoules = new anchor.BN(10_000_000);
    const efficiencyBps = 9900; // 99.00%
    const currentTimestamp = new anchor.BN(Math.floor(Date.now() / 1000));

    await program.methods
      .attestEnergy(Array.from(swarmId), irradianceJoules, efficiencyBps, currentTimestamp)
      .accounts({
        config: configPda,
        swarmUnit: swarmPda,
        tokenMint: tokenMint,
        recipientTokenAccount: receiverTokenAccount,
        receiverOwner: receiverOwner.publicKey,
        telemetrySigner: telemetrySigner.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([telemetrySigner])
      .rpc();

    const tokenBal = await provider.connection.getTokenAccountBalance(receiverTokenAccount);
    assert.isAbove(Number(tokenBal.value.amount), 0);
    console.log(`   Tokens Successfully Minted to Planetary Receiver: ${tokenBal.value.amount} HWT`);
  });

  it("4. Streams Compute Yield into Cryogenic Data Center Escrow", async () => {
    const computeUnits = new anchor.BN(500); // 500 ExaFLOPS allocated
    const amountToStream = new anchor.BN(1_000_000); // 1.000000 HWT

    await program.methods
      .streamComputeYield(computeUnits, amountToStream)
      .accounts({
        config: configPda,
        tokenMint: tokenMint,
        senderAccount: receiverTokenAccount,
        cryogenicDatacenterVault: datacenterTokenAccount,
        senderAuthority: receiverOwner.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([receiverOwner])
      .rpc();

    const datacenterBal = await provider.connection.getTokenAccountBalance(datacenterTokenAccount);
    assert.equal(datacenterBal.value.amount, "1000000");
  });

  it("5. Deterministic Edge Case: Rejects stale telemetry with timestamp drift", async () => {
    const staleTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) - 1000); // Exceeds 300s drift window
    const irradianceJoules = new anchor.BN(5_000_000);

    try {
      await program.methods
        .attestEnergy(Array.from(swarmId), irradianceJoules, 9900, staleTimestamp)
        .accounts({
          config: configPda,
          swarmUnit: swarmPda,
          tokenMint: tokenMint,
          recipientTokenAccount: receiverTokenAccount,
          receiverOwner: receiverOwner.publicKey,
          telemetrySigner: telemetrySigner.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([telemetrySigner])
        .rpc();
      assert.fail("Should have thrown InvalidTelemetryTimestamp error");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidTelemetryTimestamp");
    }
  });
});