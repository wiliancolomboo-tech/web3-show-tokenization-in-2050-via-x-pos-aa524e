# 1. Clone repository & configure environment
git clone https://github.com/solaris-2050/core-engine.git
cd core-engine
cp .env.example .env

# 2. Build Anchor Smart Contracts
anchor build

# 3. Deploy to Solana Devnet or Mainnet-Beta
solana config set --url https://api.devnet.solana.com
anchor deploy --program-name solaris_2050

# 4. Initialize Local Test Run
anchor test