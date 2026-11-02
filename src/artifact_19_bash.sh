# 1. Clone repository and change directory
git clone https://github.com/sol2050-dyson-grid/core.git
cd core

# 2. Install TypeScript testing dependencies
yarn install

# 3. Synchronize program keys
anchor keys sync

# 4. Build Anchor program binary with optimization flags
cargo build-sbf

# 5. Execute full unit and integration test suite on isolated localnet
anchor test