# 1. Build contract artifacts using Anchor CLI
anchor build

# 2. Synchronize Program ID keys
solana address -k target/deploy/heliostream-keypair.json
anchor keys sync

# 3. Deploy to Solana Localnet / Devnet / Mainnet-Beta
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor deploy --provider.cluster devnet

# 4. Initialize client environment
cd client
npm install
npm run build