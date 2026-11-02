# 1. Clone repository & install dependencies
git clone https://github.com/helios2050/helios-protocol.git
cd helios-protocol
npm install

# 2. Build Anchor Smart Contracts
anchor build

# 3. Execute Anchor Comprehensive Test Suite
anchor test

# 4. Deploy to Solana Devnet / Mainnet-Beta
solana config set --url https://api.devnet.solana.com
anchor deploy --provider.cluster Devnet

# 5. Spin up the Autonomous Enterprise Docker Daemon
docker-compose up -d --build
docker-compose logs -f