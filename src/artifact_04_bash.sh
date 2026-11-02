# Set Solana CLI to localnet
solana config set --url localhost

# Generate deployment keypair if not present
solana-keygen new --no-bip39-passphrase -o ~/.config/solana/id.json --force