use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::AssetClass;

declare_id!("SoL2050DynAmicPhysicSTokenizationEngine11111");

#[program]
pub mod solaris_2050 {
    use super::*;

    pub fn initialize_asset(
        ctx: Context<InitializeAsset>,
        asset_id: [u8; 32],
        asset_class: AssetClass,
    ) -> Result<()> {
        instructions::initialize_asset::handler(ctx, asset_id, asset_class)
    }

    pub fn record_telemetry(
        ctx: Context<RecordTelemetry>,
        epoch_index: u64,
        energy_mwh: u64,
        compute_peta_macs: u64,
        uptime_seconds: u32,
        efficiency_bps: u16,
    ) -> Result<()> {
        instructions::record_telemetry::handler(
            ctx,
            epoch_index,
            energy_mwh,
            compute_peta_macs,
            uptime_seconds,
            efficiency_bps,
        )
    }

    pub fn claim_yield(ctx: Context<ClaimYield>) -> Result<()> {
        instructions::claim_yield::handler(ctx)
    }

    pub fn emergency_pause(
        ctx: Context<EmergencyCircuitBreaker>,
        pause_status: bool,
    ) -> Result<()> {
        instructions::emergency_pause::handler(ctx, pause_status)
    }
}