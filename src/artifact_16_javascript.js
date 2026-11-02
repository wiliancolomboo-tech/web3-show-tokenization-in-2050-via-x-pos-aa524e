const program = anchor.workspace.OrbitalCompute2050;
const [configPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
console.log("Config PDA Address:", configPda.toBase58());