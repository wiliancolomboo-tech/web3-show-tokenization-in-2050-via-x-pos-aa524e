# Configure endpoint to devnet
solana config set --url https://api.devnet.solana.com

# Deploy compiled binary
solana program deploy target/deploy/sol2050_dyson_grid.so

# Verify program account integrity
solana program show DYSON20501111111111111111111111111111111111