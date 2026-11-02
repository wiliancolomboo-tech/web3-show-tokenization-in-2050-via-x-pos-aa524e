# 1. Build optimized BPF program bytecode
anchor build

# 2. Deploy smart contract to Solana Devnet
solana program deploy \
  --url https://api.devnet.solana.com \
  --program-id target/deploy/helios_grid_2050-keypair.json \
  target/deploy/helios_grid_2050.so

# 3. Synchronize program ID in Anchor.toml and source files
anchor keys sync