# Configure Environment Variables
cp .env.example .env
nano .env # Set ORCHESTRATOR_PRIVATE_KEY and ENTERPRISE_WEBHOOK_URL

# Launch via Docker Compose
docker compose up -d --build

# Verify container telemetry logs
docker compose logs -f helios-orchestrator