import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert, expect } from "chai";
import * as crypto from "crypto";

describe("aether-2050 orbital tokenization test suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Aether2050 as Program;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const oracleAuthority = anchor.web3.Keypair.generate();
  const unauthorizedUser = anchor.web3.Keypair.generate();
  const dummyEnergyMint = anchor.web3.Keypair.generate();

  const assetId = Buffer.from(
    crypto.createHash("sha256").update("DYSON_HARVESTER_01").digest().subarray(0, 16)
  );

  const [assetPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("aether_asset"), assetId],
    program.programId
  );

  before(async () => {
    // Airdrop SOL to oracle authority and unauthorized user
    const sig1 = await provider.connection.requestAirdrop(
      oracleAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    const sig2 = await provider.connection.requestAirdrop(
      unauthorizedUser.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig1);
    await provider.connection.confirmTransaction(sig2);
  });

  it("1. Successfully registers an orbital photovoltaic asset", async () => {
    const capacityMw = new anchor.BN(50_000); // 50,000 MW Capacity
    const assetName = "Dyson Constellation Alpha";

    await (program.methods as any)
      .initializeAsset(
        Array.from(assetId),
        assetName,
        capacityMw,
        oracleAuthority.publicKey
      )
      .accounts({
        assetAccount: assetPda,
        energyMint: dummyEnergyMint.publicKey,
        admin: admin.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const assetAccount = await (program.account as any).assetRegistry.fetch(assetPda);
    expect(assetAccount.name).to.equal(assetName);
    expect(assetAccount.capacityMegawatts.toNumber()).to.equal(50_000);
    expect(assetAccount.oracleAuthority.toBase58()).to.equal(
      oracleAuthority.publicKey.toBase58()
    );
    expect(assetAccount.totalMwhGenerated.toNumber()).to.equal(0);
    expect(assetAccount.isCircuitBreakerTripped).to.be.false;
  });

  it("2. Ingests valid orbital telemetry and compounds yield tranches", async () => {
    const mwhHarvested = new anchor.BN(12_000);
    const efficiencyBps = 9_500; // 95.00%
    const currentTimestamp = Math.floor(Date.now() / 1000);

    await (program.methods as any)
      .ingestTelemetry(mwhHarvested, efficiencyBps, new anchor.BN(currentTimestamp))
      .accounts({
        assetAccount: assetPda,
        oracleSigner: oracleAuthority.publicKey,
      })
      .signers([oracleAuthority])
      .rpc();

    const assetAccount = await (program.account as any).assetRegistry.fetch(assetPda);
    expect(assetAccount.totalMwhGenerated.toNumber()).to.equal(12_000);

    // Expected yield units = (12000 * 9500) / 10000 = 11,400 units
    expect(assetAccount.accumulatedYieldUnits.toNumber()).to.equal(11_400);
  });

  it("3. Rejects telemetry submission from an unauthorized oracle signer", async () => {
    const mwhHarvested = new anchor.BN(500);
    const efficiencyBps = 9_000;
    const currentTimestamp = Math.floor(Date.now() / 1000);

    try {
      await (program.methods as any)
        .ingestTelemetry(mwhHarvested, efficiencyBps, new anchor.BN(currentTimestamp))
        .accounts({
          assetAccount: assetPda,
          oracleSigner: unauthorizedUser.publicKey,
        })
        .signers([unauthorizedUser])
        .rpc();
      assert.fail("Should have thrown unauthorized oracle error");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("UnauthorizedOracle");
    }
  });

  it("4. Enforces timestamp continuity (rejects stale telemetry)", async () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 200; // Timestamp in the past

    try {
      await (program.methods as any)
        .ingestTelemetry(new anchor.BN(500), 9000, new anchor.BN(staleTimestamp))
        .accounts({
          assetAccount: assetPda,
          oracleSigner: oracleAuthority.publicKey,
        })
        .signers([oracleAuthority])
        .rpc();
      assert.fail("Should have failed on stale timestamp");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("StaleTelemetryTimestamp");
    }
  });

  it("5. Trips circuit breaker and freezes all yield minting operations", async () => {
    // Admin trips circuit breaker
    await (program.methods as any)
      .setCircuitBreaker(true)
      .accounts({
        assetAccount: assetPda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    let assetAccount = await (program.account as any).assetRegistry.fetch(assetPda);
    expect(assetAccount.isCircuitBreakerTripped).to.be.true;

    // Ingestion must now fail
    try {
      await (program.methods as any)
        .ingestTelemetry(
          new anchor.BN(1_000),
          9500,
          new anchor.BN(Math.floor(Date.now() / 1000) + 1)
        )
        .accounts({
          assetAccount: assetPda,
          oracleSigner: oracleAuthority.publicKey,
        })
        .signers([oracleAuthority])
        .rpc();
      assert.fail("Should have rejected ingestion due to tripped circuit breaker");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("CircuitBreakerActive");
    }

    // Reset circuit breaker
    await (program.methods as any)
      .setCircuitBreaker(false)
      .accounts({
        assetAccount: assetPda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    assetAccount = await (program.account as any).assetRegistry.fetch(assetPda);
    expect(assetAccount.isCircuitBreakerTripped).to.be.false;
  });
});