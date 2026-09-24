import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Astrogrid2050 } from "../target/types/astrogrid_2050";
import {
  TOKEN_2022_PROGRAM_ID,
  getAccount,
  createAssociatedTokenAccountIdempotent,
} from "@solana/spl-token";
import { expect } from "chai";

describe("astrogrid_2050_test_suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Astrogrid2050 as Program<Astrogrid2050>;
  const authority = provider.wallet as anchor.Wallet;

  const arrayId = new anchor.BN(205001);
  const totalCapacityMwh = new anchor.BN(50_000_000); // 50 Terawatt-hours scalable
  const baseYieldBps = 850; // 8.50% Base yield

  let collectorPda: anchor.web3.PublicKey;
  let energyMintPda: anchor.web3.PublicKey;
  let recipientAta: anchor.web3.PublicKey;

  before(async () => {
    [collectorPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("collector"), arrayId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    [energyMintPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("energy-mint"), arrayId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    recipientAta = await createAssociatedTokenAccountIdempotent(
      provider.connection,
      authority.payer,
      energyMintPda,
      authority.publicKey,
      {},
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("1. Initializes orbital Dyson collector with Token-2022 mint", async () => {
    const tx = await program.methods
      .initializeOrbitalCollector(arrayId, totalCapacityMwh, baseYieldBps)
      .accountsStrict({
        collectorAccount: collectorPda,
        energyMint: energyMintPda,
        authority: authority.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    expect(tx).to.be.a("string");

    const collectorState = await program.account.orbitalCollectorState.fetch(collectorPda);
    expect(collectorState.arrayId.toString()).to.equal(arrayId.toString());
    expect(collectorState.totalCapacityMwh.toString()).to.equal(totalCapacityMwh.toString());
    expect(collectorState.allocatedCapacityMwh.toNumber()).to.equal(0);
  });

  it("2. Updates orbital telemetry with ZK attestation within safe slot threshold", async () => {
    const irradianceFluxIndex = 11200; // 112% solar storm burst
    const beamEfficiencyBps = 9850;   // 98.5% atmospheric down-link efficiency

    const tx = await program.methods
      .attestOrbitalTelemetry(arrayId, irradianceFluxIndex, beamEfficiencyBps)
      .accountsStrict({
        collectorAccount: collectorPda,
        authority: authority.publicKey,
      })
      .rpc();

    expect(tx).to.be.a("string");

    const collectorState = await program.account.orbitalCollectorState.fetch(collectorPda);
    // (11200 * 9850) / 10000 = 11032
    expect(collectorState.orbitalFluxMultiplier).to.equal(11032);
  });

  it("3. Mints fractionalized energy tokens under Token-2022", async () => {
    const mintAmount = new anchor.BN(100_000); // 100,000 MWh

    const tx = await program.methods
      .mintEnergyCapacity(mintAmount)
      .accountsStrict({
        collectorAccount: collectorPda,
        energyMint: energyMintPda,
        recipientTokenAccount: recipientAta,
        recipient: authority.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    expect(tx).to.be.a("string");

    const tokenAccount = await getAccount(
      provider.connection,
      recipientAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(tokenAccount.amount)).to.equal(100_000);

    const collectorState = await program.account.orbitalCollectorState.fetch(collectorPda);
    expect(collectorState.allocatedCapacityMwh.toNumber()).to.equal(100_000);
  });

  it("4. Fails when mint exceeds total orbital capacity", async () => {
    const excessiveAmount = new anchor.BN(60_000_000); // Exceeds 50M limit

    try {
      await program.methods
        .mintEnergyCapacity(excessiveAmount)
        .accountsStrict({
          collectorAccount: collectorPda,
          energyMint: energyMintPda,
          recipientTokenAccount: recipientAta,
          recipient: authority.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have thrown CapacityExceeded error");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("CapacityExceeded");
    }
  });
});