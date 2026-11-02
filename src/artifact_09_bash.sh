# 1. Build Solana Program
anchor build

# 2. Deploy to Solana Devnet/Testnet
solana program deploy target/deploy/aether_2050.so \
  --program-id target/deploy/aether_2050-keypair.json \
  --url https://api.devnet.solana.com

# 3. Provision Environment File
cat <<EOF > .env
RESEND_API_KEY=re_123456789abcdef
ENTERPRISE_WEBHOOK_URL=https://api.example.com/webhooks/alerts/placeholder
AUDIT_EMAIL_RECIPIENT=treasury-custody@orbital.energy
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
EOF

# 4. Launch Autonomous Ingestion Engine
docker compose up -d --build

# 5. Inspect Real-time Telemetry Settlement
docker compose logs -f aether-oracle-daemon