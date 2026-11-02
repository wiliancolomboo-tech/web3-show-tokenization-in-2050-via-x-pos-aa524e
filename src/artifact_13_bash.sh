# Install dependencies
npm install

# Copy configuration
cp .env.example .env

# Run Orchestration Daemon
npx ts-node client/helios-orchestrator.ts