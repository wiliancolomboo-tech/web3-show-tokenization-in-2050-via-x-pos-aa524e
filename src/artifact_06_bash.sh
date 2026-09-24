# 1. Clone and navigate to workspace
mkdir -p astrogrid-2050 && cd astrogrid-2050

# 2. Initialize project structure
anchor init . --javascript false

# 3. Configure local validator to support Token-2022
solana config set --url localhost

# 4. Build program and verify binary size
anchor build

# 5. Launch Anchor Localnet Test Suite
anchor test