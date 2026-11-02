import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Helios2050 } from "../target/types/helios_2050";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAccount,
  getAccount,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert, expect } from "chai";

describe("helios_2050 Enterprise Test Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Helios2050 as Program<Helios2050>;

  const authority = Keypair.generate();
  const telemetryOracle = Keypair.generate();
  const unauthorizedSigner = Keypair.generate();

  let energyMint: PublicKey;
  let collectorReserve: PublicKey;
  let globalConfigPda: PublicKey;
  let bump: number;

  before(async () => {
    // Fund accounts
    const airdropSig1 = await provider.connection.requestAirdrop(authority.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    const airdropSig2 = await provider.connection.requestAirdrop(telemetryOracle.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropSig1);
    await provider.connection.confirmTransaction(airdropSig2);

    // Derive PDA
    [globalConfigPda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("helios-config")],
      program.programId
    );

    // Create Token-2022 Mint with globalConfigPda as Mint Authority
    energyMint = await createMint(
      provider.connection,
      authority,
      globalConfigPda,
      null,
      6,
      Keypair.generate(),
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create Associated Token Account for reserve yields
    collectorReserve = await createAccount(
      provider.connection,
      authority,
      energyMint,
      authority.publicKey,
      Keypair.generate(),
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("1. Successfully initializes the 2050 Orbital Asset Stream", async () => {
    const collectorId = "DYSON-ARRAY-NODE-01";
    const baseRateBps = 350; // 3.5%

    await program.methods
      .initializeAssetStream(collectorId, baseRateBps)
      .accounts({
        globalConfig: globalConfigPda,
        authority: authority.publicKey,
        telemetryOracle: telemetryOracle.publicKey,
        energyMint: energyMint,
        systemProgram: SystemProgram.programId,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([authority])
      .rpc();

    const configAccount = await program.account.globalConfig.fetch(globalConfigPda);
    assert.equal(configAccount.collectorId, collectorId);
    assert.equal(configAccount.baseYieldRateBps, baseRateBps);
    assert.isFalse(configAccount.emergencyLockout);
    assert.isTrue(configAccount.telemetryOracle.equals(telemetryOracle.publicKey));
  });

  it("2. Ingests nominal orbital telemetry and mints streaming energy units", async () => {
    const megawatts = new anchor.BN(500); // 500 MW
    const exaFlops = new anchor.BN(2);     // 2 ExaFlops
    const radiationSafe = 120;
    const now = Math.floor(Date.now() / 1000);

    const initialReserve = await getAccount(
      provider.connection,
      collectorReserve,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    await program.methods
      .ingestTelemetryAndSettle(megawatts, exaFlops, radiationSafe, new anchor.BN(now))
      .accounts({
        globalConfig: globalConfigPda,
        telemetryOracle: telemetryOracle.publicKey,
        energyMint: energyMint,
        collectorReserve: collectorReserve,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .signers([telemetryOracle])
      .rpc();

    const updatedReserve = await getAccount(
      provider.connection,
      collectorReserve,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    // Expected tokens = (500 * 1000) + (2 * 250) = 500,500 units
    const expectedMint = 500 * 1000 + 2 * 250;
    const diff = Number(updatedReserve.amount - initialReserve.amount);
    assert.equal(diff, expectedMint);
  });

  it("3. Rejects telemetry if signed by an unauthorized oracle", async () => {
    const megawatts = new anchor.BN(200);
    const exaFlops = new anchor.BN(1);
    const now = Math.floor(Date.now() / 1000);

    try {
      await program.methods
        .ingestTelemetryAndSettle(megawatts, exaFlops, 100, new anchor.BN(now))
        .accounts({
          globalConfig: globalConfigPda,
          telemetryOracle: unauthorizedSigner.publicKey,
          energyMint: energyMint,
          collectorReserve: collectorReserve,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .signers([unauthorizedSigner])
        .rpc();
      assert.fail("Should have thrown unauthorized oracle error");
    } catch (err: any) {
      expect(err.toString()).to.include("UnauthorizedTelemetryOracle");
    }
  });

  it("4. Automatically triggers Parametric Solar Flare Emergency Circuit Breaker", async () => {
    const extremeRadiation = 992; // Above safety threshold of 950
    const megawatts = new anchor.BN(100);
    const exaFlops = new anchor.BN(1);
    const now = Math.floor(Date.now() / 1000);

    await program.methods
      .ingestTelemetryAndSettle(megawatts, exaFlops, extremeRadiation, new anchor.BN(now))
      .accounts({
        globalConfig: globalConfigPda,
        telemetryOracle: telemetryOracle.publicKey,
        energyMint: energyMint,
        collectorReserve: collectorReserve,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .signers([telemetryOracle])
      .rpc();

    const configAccount = await program.account.globalConfig.fetch(globalConfigPda);
    assert.isTrue(configAccount.emergencyLockout, "Protocol must trip into emergency lockout");
  });

  it("5. Rejects any further settlement while in emergency lockdown", async () => {
    const now = Math.floor(Date.now() / 1000);
    try {
      await program.methods
        .ingestTelemetryAndSettle(new anchor.BN(100), new anchor.BN(1), 100, new anchor.BN(now))
        .accounts({
          globalConfig: globalConfigPda,
          telemetryOracle: telemetryOracle.publicKey,
          energyMint: energyMint,
          collectorReserve: collectorReserve,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .signers([telemetryOracle])
        .rpc();
      assert.fail("Settlement must fail during lockout");
    } catch (err: any) {
      expect(err.toString()).to.include("SystemEmergencyLocked");
    }
  });

  it("6. Sovereign authority restores orbital operations", async () => {
    await program.methods
      .resumeSystemLockout()
      .accounts({
        globalConfig: globalConfigPda,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const config = await program.account.globalConfig.fetch(globalConfigPda);
    assert.isFalse(config.emergencyLockout, "Lockout must be lifted by authorized signer");
  });
});