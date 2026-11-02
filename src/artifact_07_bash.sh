# 1. Install Solana 1.18 & Anchor 0.30
solana --version
anchor --version

# 2. Build the Anchor Token-2022 Program
anchor build

# 3. Configure network and deploy to Solana Devnet/Testnet
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor deploy --program-name helios_2050

# 4. Verify Program Deployment
solana program show HeLioS20501111111111111111111111111111111111