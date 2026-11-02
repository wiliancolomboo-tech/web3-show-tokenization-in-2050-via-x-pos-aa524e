# 1. Clone repository & install dependencies
git clone https://github.com/helios-2050/helios-protocol.git
cd helios-protocol
npm install

# 2. Build Anchor Smart Contracts
anchor build

# 3. Execute Complete Test Matrix against local Solana test-validator
anchor test