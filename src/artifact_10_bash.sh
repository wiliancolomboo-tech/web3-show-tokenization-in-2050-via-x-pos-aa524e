# 1. Build Solana Program
anchor build

# 2. Deploy to Solana Devnet / Localnet
solana program deploy ./target/deploy/aether_2050.so \
  --program-id AeTH5ovC7E9sT86uH9jK5k8Gnm9nC6c7H8o9pQrStUv \
  --url devnet

# 3. Spin up Autonomous Relayer & Telemetry Engine
export RESEND_API_KEY="re_live_enterpriseproof2050"
export DISCORD_WEBHOOK_URL="https://api.example.com/webhooks/alerts/placeholder"
docker-compose up -d --build

# 4. View Real-Time Health & Transaction Logs
docker-compose logs -f aether-orchestrator