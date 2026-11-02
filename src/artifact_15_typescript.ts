import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAccount,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Solaris2050 } from "../target/types/solaris_2050";

describe("solaris-2050 Protocol Test Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Solaris2050 as Program<Solaris2050>;

  const authority = Keypair.generate();
  const enclaveSigner = Keypair.generate();
  const investor = Keypair.generate();

  let resourceMint: PublicKey;
  let investorAta: PublicKey;
  let mintAuthorityPda: PublicKey;

  const rawAssetId = "ORBITAL-SOLAR-STATION-ALPHA";
  const assetIdBytes = new Uint8Array(32);
  Buffer.from(rawAssetId).copy(Buffer.from(assetIdBytes.buffer));

  let assetPda: PublicKey;
  let assetBump: number;

  before(async () => {
    // Airdrop funds to authority and enclave
    for (const key of [authority, enclaveSigner, investor]) {
      const airdropSig = await provider.connection.requestAirdrop(
        key.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);
    }

    [assetPda, assetBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("asset"), Buffer.from(assetIdBytes)],
      program.programId
    );

    [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_authority"), assetPda.toBuffer()],
      program.programId
    );

    // Create Token-2022 Resource Token Mint with mint authority given to mintAuthorityPda
    resourceMint = await createMint(
      provider.connection,
      authority,
      mintAuthorityPda,
      null,
      6,
      Keypair.generate(),
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    investorAta = await createAccount(
      provider.connection,
      investor,
      resourceMint,
      investor.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("1. Successfully registers a physical orbital energy asset", async () => {
    await program.methods
      .initializeAsset(Array.from(assetIdBytes), { orbitalSolarArray: {} })
      .accounts({
        assetManifest: assetPda,
        resourceTokenMint: resourceMint,
        hardwareEnclaveSigner: enclaveSigner.publicKey,
        authority: authority.publicKey,
        payer: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const manifest = await program.account.assetManifest.fetch(assetPda);
    expect(manifest.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(manifest.hardwareEnclaveSigner.toBase58()).to.equal(enclaveSigner.publicKey.toBase58());
    expect(manifest.isActive).to.be.true;
    expect(manifest.efficiencyBps).to.equal(10000);
    expect(manifest.totalUnitsMinted.toNumber()).to.equal(0);
  });

  it("2. Hardware enclave successfully records physical telemetry epoch #1", async () => {
    const epoch = new anchor.BN(1);
    const epochBuffer = Buffer.alloc(8);
    epochBuffer.writeBigUInt64LE(BigInt(1));

    const [telemetryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("telemetry"), Buffer.from(assetIdBytes), epochBuffer],
      program.programId
    );

    const energyMwh = new anchor.BN(500); // 500 MWh
    const computePetaMacs = new anchor.BN(1200); // 1,200 PetaMACs
    const uptimeSeconds = 86400; // 24 hours full uptime
    const efficiencyBps = 9950; // 99.50%

    await program.methods
      .recordTelemetry(epoch, energyMwh, computePetaMacs, uptimeSeconds, efficiencyBps)
      .accounts({
        assetManifest: assetPda,
        telemetryRecord: telemetryPda,
        hardwareEnclaveSigner: enclaveSigner.publicKey,
        payer: enclaveSigner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([enclaveSigner])
      .rpc();

    const record = await program.account.telemetryRecord.fetch(telemetryPda);
    expect(record.energyMegawattHours.toNumber()).to.equal(500);
    expect(record.computePetaMacs.toNumber()).to.equal(1200);
    expect(record.uptimeSeconds).to.equal(86400);

    const manifest = await program.account.assetManifest.fetch(assetPda);
    expect(manifest.lastTelemetryEpoch.toNumber()).to.equal(1);
    expect(manifest.efficiencyBps).to.equal(9950);
  });

  it("3. Claims verified thermodynamic dynamic yield to investor ATA", async () => {
    const epochBuffer = Buffer.alloc(8);
    epochBuffer.writeBigUInt64LE(BigInt(1));

    const [telemetryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("telemetry"), Buffer.from(assetIdBytes), epochBuffer],
      program.programId
    );

    await program.methods
      .claimYield()
      .accounts({
        assetManifest: assetPda,
        telemetryRecord: telemetryPda,
        resourceTokenMint: resourceMint,
        mintAuthorityPda: mintAuthorityPda,
        destinationTokenAccount: investorAta,
        beneficiary: investor.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([investor])
      .rpc();

    const tokenBalance = await getAccount(
      provider.connection,
      investorAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Expected:
    // Base Yield = (500 * 1,000,000) + (1200 * 100,000) = 500,000,000 + 120,000,000 = 620,000,000
    // Adjusted = (620,000,000 * 9950) / 10000 = 616,900,000
    expect(Number(tokenBalance.amount)).to.equal(616900000);
  });

  it("4. Prevents stale epoch recording (Replay Protection)", async () => {
    const staleEpoch = new anchor.BN(1);
    const epochBuffer = Buffer.alloc(8);
    epochBuffer.writeBigUInt64LE(BigInt(1));

    const [telemetryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("telemetry"), Buffer.from(assetIdBytes), epochBuffer],
      program.programId
    );

    try {
      await program.methods
        .recordTelemetry(staleEpoch, new anchor.BN(10), new anchor.BN(10), 1000, 9000)
        .accounts({
          assetManifest: assetPda,
          telemetryRecord: telemetryPda,
          hardwareEnclaveSigner: enclaveSigner.publicKey,
          payer: enclaveSigner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([enclaveSigner])
        .rpc();
      expect.fail("Should have thrown StaleEpochReported error");
    } catch (err: any) {
      expect(err.toString()).to.include("StaleEpochReported");
    }
  });

  it("5. Triggers emergency circuit breaker pause and blocks yield claims", async () => {
    // Pause the asset
    await program.methods
      .emergencyPause(true)
      .accounts({
        assetManifest: assetPda,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const manifest = await program.account.assetManifest.fetch(assetPda);
    expect(manifest.isActive).to.be.false;

    // Verify claim attempt fails
    const epochBuffer = Buffer.alloc(8);
    epochBuffer.writeBigUInt64LE(BigInt(1));
    const [telemetryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("telemetry"), Buffer.from(assetIdBytes), epochBuffer],
      program.programId
    );

    try {
      await program.methods
        .claimYield()
        .accounts({
          assetManifest: assetPda,
          telemetryRecord: telemetryPda,
          resourceTokenMint: resourceMint,
          mintAuthorityPda: mintAuthorityPda,
          destinationTokenAccount: investorAta,
          beneficiary: investor.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([investor])
        .rpc();
      expect.fail("Should have failed while paused");
    } catch (err: any) {
      expect(err.toString()).to.include("ProtocolPaused");
    }
  });
});