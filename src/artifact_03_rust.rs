use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

declare_id!("AEThER2o5o111111111111111111111111111111111");

pub const MAX_EFFICIENCY_BPS: u16 = 10_000;
pub const MAX_ALLOWED_TELEMETRY_GAP_SECS: i64 = 300; // 5-minute maximum tolerance

#[program]
pub mod aether_2050 {
    use super::*;

    /// Initialize a newly deployed Orbital Photovoltaic or Carbon Hub Asset
    pub fn initialize_asset(
        ctx: Context<InitializeAsset>,
        asset_id: [u8; 16],
        name: String,
        capacity_megawatts: u64,
        oracle_authority: Pubkey,
    ) -> Result<()> {
        require!(name.len() <= 32, AetherError::NameTooLong);
        require!(capacity_megawatts > 0, AetherError::InvalidCapacity);

        let asset = &mut ctx.accounts.asset_account;
        asset.bump = ctx.bumps.asset_account;
        asset.admin = ctx.accounts.admin.key();
        asset.oracle_authority = oracle_authority;
        asset.asset_id = asset_id;
        asset.name = name;
        asset.capacity_megawatts = capacity_megawatts;
        asset.total_mwh_generated = 0;
        asset.accumulated_yield_units = 0;
        asset.last_telemetry_timestamp = Clock::get()?.unix_timestamp;
        asset.is_circuit_breaker_tripped = false;
        asset.energy_mint = ctx.accounts.energy_mint.key();

        emit!(AssetRegisteredEvent {
            asset_id,
            capacity_megawatts,
            oracle_authority,
            timestamp: asset.last_telemetry_timestamp,
        });

        Ok(())
    }

    /// Ingest verified telemetry proof from the autonomous satellite constellation oracle
    pub fn ingest_telemetry(
        ctx: Context<IngestTelemetry>,
        mwh_harvested: u64,
        efficiency_bps: u16,
        telemetry_timestamp: i64,
    ) -> Result<()> {
        let asset = &mut ctx.accounts.asset_account;
        let current_time = Clock::get()?.unix_timestamp;

        // Validation Checks
        require!(!asset.is_circuit_breaker_tripped, AetherError::CircuitBreakerActive);
        require!(
            ctx.accounts.oracle_signer.key() == asset.oracle_authority,
            AetherError::UnauthorizedOracle
        );
        require!(
            efficiency_bps <= MAX_EFFICIENCY_BPS,
            AetherError::InvalidEfficiencyMetric
        );
        require!(
            telemetry_timestamp > asset.last_telemetry_timestamp,
            AetherError::StaleTelemetryTimestamp
        );
        require!(
            (current_time - telemetry_timestamp).abs() <= MAX_ALLOWED_TELEMETRY_GAP_SECS,
            AetherError::TelemetryDriftExceeded
        );

        // State Transitions
        asset.total_mwh_generated = asset
            .total_mwh_generated
            .checked_add(mwh_harvested)
            .ok_or(AetherError::MathOverflow)?;

        // Calculate dynamic energy yield tranche: (mwh_harvested * efficiency_bps) / 10000
        let yield_units = (mwh_harvested as u128)
            .checked_mul(efficiency_bps as u128)
            .ok_or(AetherError::MathOverflow)?
            .checked_div(MAX_EFFICIENCY_BPS as u128)
            .ok_or(AetherError::MathOverflow)? as u64;

        asset.accumulated_yield_units = asset
            .accumulated_yield_units
            .checked_add(yield_units)
            .ok_or(AetherError::MathOverflow)?;

        asset.last_telemetry_timestamp = telemetry_timestamp;

        emit!(TelemetryIngestedEvent {
            asset_id: asset.asset_id,
            mwh_harvested,
            efficiency_bps,
            yield_units_created: yield_units,
            total_mwh: asset.total_mwh_generated,
            timestamp: telemetry_timestamp,
        });

        Ok(())
    }

    /// Trigger Emergency Safety Trip (e.g. Coronal Mass Ejection or Physical Collision)
    pub fn set_circuit_breaker(ctx: Context<SetCircuitBreaker>, trip: bool) -> Result<()> {
        let asset = &mut ctx.accounts.asset_account;
        require!(
            ctx.accounts.admin.key() == asset.admin
                || ctx.accounts.admin.key() == asset.oracle_authority,
            AetherError::UnauthorizedAdmin
        );

        asset.is_circuit_breaker_tripped = trip;

        emit!(CircuitBreakerStateChangedEvent {
            asset_id: asset.asset_id,
            is_tripped: trip,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT CONTEXTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(asset_id: [u8; 16])]
pub struct InitializeAsset<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + AssetRegistry::INIT_SPACE,
        seeds = [b"aether_asset", asset_id.as_ref()],
        bump
    )]
    pub asset_account: Account<'info, AssetRegistry>,

    pub energy_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct IngestTelemetry<'info> {
    #[account(
        mut,
        seeds = [b"aether_asset", asset_account.asset_id.as_ref()],
        bump = asset_account.bump,
    )]
    pub asset_account: Account<'info, AssetRegistry>,

    pub oracle_signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetCircuitBreaker<'info> {
    #[account(
        mut,
        seeds = [b"aether_asset", asset_account.asset_id.as_ref()],
        bump = asset_account.bump,
    )]
    pub asset_account: Account<'info, AssetRegistry>,

    pub admin: Signer<'info>,
}

// -----------------------------------------------------------------------------
// STATE STRUCTS
// -----------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct AssetRegistry {
    pub bump: u8,
    pub admin: Pubkey,
    pub oracle_authority: Pubkey,
    pub asset_id: [u8; 16],
    #[max_len(32)]
    pub name: String,
    pub capacity_megawatts: u64,
    pub total_mwh_generated: u64,
    pub accumulated_yield_units: u64,
    pub last_telemetry_timestamp: i64,
    pub is_circuit_breaker_tripped: bool,
    pub energy_mint: Pubkey,
}

// -----------------------------------------------------------------------------
// EVENTS
// -----------------------------------------------------------------------------

#[event]
pub struct AssetRegisteredEvent {
    pub asset_id: [u8; 16],
    pub capacity_megawatts: u64,
    pub oracle_authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TelemetryIngestedEvent {
    pub asset_id: [u8; 16],
    pub mwh_harvested: u64,
    pub efficiency_bps: u16,
    pub yield_units_created: u64,
    pub total_mwh: u64,
    pub timestamp: i64,
}

#[event]
pub struct CircuitBreakerStateChangedEvent {
    pub asset_id: [u8; 16],
    pub is_tripped: bool,
    pub timestamp: i64,
}

// -----------------------------------------------------------------------------
// ERRORS
// -----------------------------------------------------------------------------

#[error_code]
pub enum AetherError {
    #[msg("Asset name exceeds 32 byte boundary.")]
    NameTooLong,
    #[msg("Capacity in megawatts must be strictly positive.")]
    InvalidCapacity,
    #[msg("Calculated efficiency exceeds maximum allowed 10,000 basis points.")]
    InvalidEfficiencyMetric,
    #[msg("Provided telemetry timestamp is stale or prior to current state.")]
    StaleTelemetryTimestamp,
    #[msg("Telemetry timestamp drifts outside real-time tolerance window.")]
    TelemetryDriftExceeded,
    #[msg("Signer is not authorized to act as oracle.")]
    UnauthorizedOracle,
    #[msg("Signer is not authorized to act as admin.")]
    UnauthorizedAdmin,
    #[msg("Circuit breaker is currently tripped due to safety protocols.")]
    CircuitBreakerActive,
    #[msg("Mathematical overflow encountered during yield calculations.")]
    MathOverflow,
}