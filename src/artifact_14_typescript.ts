import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aetheris2050 } from "../target/types/aetheris_2050";
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
import * as crypto from "crypto";

describe("aetheris_2050 e2e planetary test suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Aetheris2050 as Program<Aetheris2050>;
  const authority = provider.wallet as anchor.Wallet;

  let photonMint: PublicKey;
  let registryPda: PublicKey;
  let registryBump: number;

  const enclaveKeypair = Keypair.generate();
  const recipientKeypair = Keypair.generate();
  let recipientAta: PublicKey;

  const assetId = Array.from(crypto.randomBytes(16));

  before(async () => {
    // 1. Derive Registry PDA
    [registryPda, registryBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("orbital_registry")],
      program.programId
    );

    // 2. Initialize Token-2022 Mint with Registry PDA as Mint Authority
    photonMint = await createMint(
      provider.connection,
      authority.payer,
      registryPda, // PDA holds mint authority
      null,
      9,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // 3. Create ATA for consumer recipient under Token-2022
    recipientAta = await createAccount(
      provider.connection,
      authority.payer,
      photonMint,
      recipientKeypair.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("1. Initializes Planetary Registry with Token-2022 Mint", async () => {
    const tx = await program.methods
      .initializeRegistry(photonMint)
      .accounts({
        registry: registryPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    expect(tx).to.be.a("string");
    const regData = await program.account.registryConfig.fetch(registryPda);
    expect(regData.photonMint.toBase58()).to.equal(photonMint.toBase58());
    expect(regData.totalActiveArrays.toNumber()).to.equal(0);
  });

  it("2. Registers an Orbital Dyson Photovoltaic Harvester", async () => {
    const [harvesterPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("harvester_asset"), Buffer.from(assetId)],
      program.programId
    );

    await program.methods
      .initializeAsset(assetId, 1800) // Sector 180.0 degrees
      .accounts({
        registry: registryPda,
        harvester: harvesterPda,
        authority: authority.publicKey,
        enclaveAttestor: enclaveKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const harvesterData = await program.account.harvesterAsset.fetch(harvesterPda);
    expect(harvesterData.enclaveAttestor.toBase58()).to.equal(enclaveKeypair.publicKey.toBase58());
    expect(harvesterData.active).to.be.true;
    expect(harvesterData.inPenumbra).to.be.false;
  });

  it("3. Ingests Real-Time Telemetry and Mints Streaming Photon Tokens", async () => {
    const [harvesterPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("harvester_asset"), Buffer.from(assetId)],
      program.programId
    );

    const deltaEnergyKwh = new anchor.BN(5_000); // 5,000 kWh
    const instantaneousOutputKw = 25_000; // 25 MW

    await program.methods
      .updateTelemetry(assetId, deltaEnergyKwh, instantaneousOutputKw, false)
      .accounts({
        registry: registryPda,
        harvester: harvesterPda,
        enclaveAttestor: enclaveKeypair.publicKey,
        photonMint: photonMint,
        recipientTokenAccount: recipientAta,
        recipient: recipientKeypair.publicKey,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .signers([enclaveKeypair])
      .rpc();

    // Verify token balance received: 5000 kWh * 10^9 decimals
    const tokenBalance = await getAccount(
      provider.connection,
      recipientAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(tokenBalance.amount.toString()).to.equal(
      deltaEnergyKwh.mul(new anchor.BN(1_000_000_000)).toString()
    );
  });

  it("4. Enforces Thermodynamic Violations (Security Audit Test)", async () => {
    const [harvesterPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("harvester_asset"), Buffer.from(assetId)],
      program.programId
    );

    // 150,000 kW exceeds physical max threshold of 100,000 kW
    try {
      await program.methods
        .updateTelemetry(assetId, new anchor.BN(10_000), 150_000, false)
        .accounts({
          registry: registryPda,
          harvester: harvesterPda,
          enclaveAttestor: enclaveKeypair.publicKey,
          photonMint: photonMint,
          recipientTokenAccount: recipientAta,
          recipient: recipientKeypair.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .signers([enclaveKeypair])
        .rpc();
      expect.fail("Should have thrown ThermodynamicYieldViolation error");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("ThermodynamicYieldViolation");
    }
  });

  it("5. Rejects Telemetry with False Penumbra Status", async () => {
    const [harvesterPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("harvester_asset"), Buffer.from(assetId)],
      program.programId
    );

    // If inPenumbra is true, output must be zero
    try {
      await program.methods
        .updateTelemetry(assetId, new anchor.BN(1_000), 5_000, true)
        .accounts({
          registry: registryPda,
          harvester: harvesterPda,
          enclaveAttestor: enclaveKeypair.publicKey,
          photonMint: photonMint,
          recipientTokenAccount: recipientAta,
          recipient: recipientKeypair.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .signers([enclaveKeypair])
        .rpc();
      expect.fail("Should have thrown ArrayInPenumbraLock error");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("ArrayInPenumbraLock");
    }
  });
});