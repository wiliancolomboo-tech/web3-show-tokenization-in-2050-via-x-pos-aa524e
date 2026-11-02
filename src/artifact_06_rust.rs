use anchor_lang::prelude::*;

pub const ORBITAL_REGISTRY_SEED: &[u8] = b"orbital_registry";
pub const HARVESTER_ASSET_SEED: &[u8] = b"harvester_asset";
pub const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

#[account]
#[derive(Default)]
pub struct RegistryConfig {
    pub authority: Pubkey,
    pub photon_mint: Pubkey,
    pub total_active_arrays: u64,
    pub total_energy_harvested_gwh: u128,
    pub bump: u8,
}

impl RegistryConfig {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 16 + 1;
}

#[account]
#[derive(Default)]
pub struct HarvesterAsset {
    pub asset_id: [u8; 16],          // UUIDv4 format
    pub orbital_sector: u16,         // 0 - 3600 (Deci-degrees Lagrange orbit)
    pub enclave_attestor: Pubkey,    // Hardware enclave identity
    pub cumulative_energy_mwh: u64,  // Total lifetime MWh
    pub instantaneous_output_kw: u32,// Real-time metric
    pub last_telemetry_timestamp: i64,
    pub in_penumbra: bool,           // True if eclipsed
    pub active: bool,
    pub bump: u8,
}

impl HarvesterAsset {
    pub const LEN: usize = 8 + 16 + 2 + 32 + 8 + 4 + 8 + 1 + 1 + 1;
}