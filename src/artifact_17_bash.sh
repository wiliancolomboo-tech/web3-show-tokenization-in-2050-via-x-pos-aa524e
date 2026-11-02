# 1. Build Smart Contracts
anchor build

# 2. Deploy to Solana Devnet / Testnet
solana config set --url https://api.devnet.solana.com
anchor deploy --provider.cluster devnet

# 3. Launch Self-Healing Ingestion Engine
docker compose up -d --build

# 4. View Real-Time Telemetry Stream
docker logs -f aetheris_planetary_agent