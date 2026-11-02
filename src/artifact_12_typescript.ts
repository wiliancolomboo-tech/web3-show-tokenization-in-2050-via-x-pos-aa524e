import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { HeliosCore } from "../target/types/helios_core";
import { 
  TOKEN_2022_PROGRAM_ID, 
  createMint, 
  getAccount, 
  getMint 
} from "@solana/spl-token";
import { expect } from "chai";

describe("Helios-50 Protocol: Year 2050 Verification Test Battery", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HeliosCore as Program<HeliosCore>;
  const authority = provider.wallet;

  let stationId = new anchor.BN(2050);
  let mintKeypair = anchor.web3.Keypair.generate();
  let sensorKeypair = anchor.web3.Keypair.generate();
  let mintPubkey: anchor.web3.PublicKey;
  let stationPda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;

  before(async () => {
    // 1. Derive Station PDA
    [stationPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("orbital_station"), stationId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // 2. Derive Vault PDA
    [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("harvest_vault"), stationPda.toBuffer()],
      program.programId
    );

    // 3. Create Token-2022 Mint with Station as Mint Authority
    mintPubkey = await createMint(
      provider.connection,
      (authority as any).payer,
      stationPda, // station PDA is authority
      null,
      6,
      mintKeypair,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("1. Initializes an Orbital Dyson Collector Station", async () => {
    await program.methods
      .initializeStation(stationId)
      .accounts({
        authority: authority.publicKey,
        sensorPubkey: sensorKeypair.publicKey,
        mint: mintPubkey,
        station: stationPda,
        tokenVault: vaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const stationAccount = await program.account.orbitalStation.fetch(stationPda);
    expect(stationAccount.stationId.toNumber()).to.equal(2050);
    expect(stationAccount.operationalStatus).to.equal(1);
    expect(stationAccount.mint.toBase58()).to.equal(mintPubkey.toBase58());
  });

  it("2. Deterministically mints $PHOTON on valid photonic telemetry downlink", async () => {
    const now = Math.floor(Date.now() / 1000);
    const telemetryData = {
      averageFluxWM2: new anchor.BN(1500000), // 15,000.00 W/m²
      collectorEffectiveAreaM2: 10_000,       // 10,000 m²
      timestampStart: new anchor.BN(now - 100),
      timestampEnd: new anchor.BN(now),
      flareIndex: 50,                          // Safe
    };

    // Expected:
    // Watts = 15,000 * 10,000 = 150,000,000 W
    // Joules = 150,000,000 * 100 = 15,000,000,000 Joules
    // Tokens base units = 15,000,000,000 (with 6 decimals = 15,000.000000 $PHOTON)
    await program.methods
      .settleHarvestEpoch(telemetryData)
      .accounts({
        relayAuthority: authority.publicKey,
        station: stationPda,
        mint: mintPubkey,
        tokenVault: vaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const vaultAccount = await getAccount(
      provider.connection,
      vaultPda,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    expect(Number(vaultAccount.amount)).to.equal(15_000_000_000);
  });

  it("3. Engages Circuit Breaker and blocks minting during Severe Coronal Flare", async () => {
    const now = Math.floor(Date.now() / 1000);
    const extremeFlareTelemetry = {
      averageFluxWM2: new anchor.BN(9000000),
      collectorEffectiveAreaM2: 10_000,
      timestampStart: new anchor.BN(now - 10),
      timestampEnd: new anchor.BN(now),
      flareIndex: 980, // Over 800 trigger threshold
    };

    await program.methods
      .settleHarvestEpoch(extremeFlareTelemetry)
      .accounts({
        relayAuthority: authority.publicKey,
        station: stationPda,
        mint: mintPubkey,
        tokenVault: vaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const stationAccount = await program.account.orbitalStation.fetch(stationPda);
    // Operational status must shift to 2 (Safe-Mode)
    expect(stationAccount.operationalStatus).to.equal(2);
  });

  it("4. Prevents settlement attempts while in Safe-Mode", async () => {
    const now = Math.floor(Date.now() / 1000);
    const telemetry = {
      averageFluxWM2: new anchor.BN(1500000),
      collectorEffectiveAreaM2: 10_000,
      timestampStart: new anchor.BN(now - 10),
      timestampEnd: new anchor.BN(now),
      flareIndex: 20,
    };

    try {
      await program.methods
        .settleHarvestEpoch(telemetry)
        .accounts({
          relayAuthority: authority.publicKey,
          station: stationPda,
          mint: mintPubkey,
          tokenVault: vaultPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have thrown StationInactive");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("StationInactive");
    }
  });
});