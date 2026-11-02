# 1. Build and verify the on-chain Anchor program
anchor build

# 2. Deploy to Solana Devnet (or Local Validator)
solana program deploy target/deploy/chronogrid_2050.so --program-id ChronoGrid20501111111111111111111111111111111

# 3. Run full automated integration test suite
anchor test --skip-local-validator

# 4. Launch 2050 Autonomous Ingestion Worker Container
docker-compose up --build -d

# 5. Verify service healthcheck
curl -I http://localhost:8080/health