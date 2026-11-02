use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, MintTo, Burn, Token2022};
use anchor_spl::token_interface::{Mint, TokenAccount};

declare_id!("Helios205011111111111111111111111111111111");

pub const CONFIG_SEED: &[u8] = b"helios-config";
pub const ORBITAL_VAULT_SEED: &[u8] = b"orbital-vault";
pub const MAX_TELEMETRY_LATENCY_SECS: i64 = 180; // Inter-planetary relay latency tolerance
pub const SOLAR_FLARE_EMERGENCY_WATTS: u64 = 10_000_000; // 10 GW threshold trip

#[program]
pub mod helios_2050 {
    use super::*;

    /// Initializes a new 2050 Orbital Collector Asset Engine
    pub fn initialize_asset_stream(
        ctx: Context<InitializeAssetStream>,
        collector_id: String,
        base_rate_bps: i16,
    ) -> Result<()> {
        require!(collector_id.len() <= 32, HeliosError::IdentifierTooLong);
        require!(base_rate_bps >= 0, HeliosError::InvalidRateConfig);

        let config = &mut ctx.accounts.global_config;
        config.authority = ctx.accounts.authority.key();
        config.telemetry_oracle = ctx.accounts.telemetry_oracle.key();
        config.energy_mint = ctx.accounts.energy_mint.key();
        config.collector_id = collector_id;
        config.total_energy_harvested_mwh = 0;
        config.total_compute_flops_exascale = 0;
        config.last_telemetry_timestamp = Clock::get()?.unix_timestamp;
        config.base_yield_rate_bps = base_rate_bps;
        config.emergency_lockout = false;
        config.bump = ctx.bumps.global_config;

        emit!(StreamInitializedEvent {
            collector_id: config.collector_id.clone(),
            authority: config.authority,
            timestamp: config.last_telemetry_timestamp,
        });

        Ok(())
    }

    /// Ingests zero-trust space-relay telemetry and mints continuous yield fractions
    pub fn ingest_telemetry_and_settle(
        ctx: Context<IngestTelemetryAndSettle>,
        megawatts_harvested: u64,
        exascale_flops_delivered: u64,
        space_radiation_index: u32,
        telemetry_timestamp: i64,
    ) -> Result<()> {
        let current_time = Clock::get()?.unix_timestamp;
        let config = &mut ctx.accounts.global_config;

        // Security Validation
        require!(!config.emergency_lockout, HeliosError::SystemEmergencyLocked);
        require!(
            ctx.accounts.telemetry_oracle.key() == config.telemetry_oracle,
            HeliosError::UnauthorizedTelemetryOracle
        );
        require!(
            telemetry_timestamp <= current_time,
            HeliosError::FutureTelemetryTime
        );
        require!(
            current_time - telemetry_timestamp <= MAX_TELEMETRY_LATENCY_SECS,
            HeliosError::StaleTelemetryStream
        );

        // Emergency Parametric Circuit Breaker: Coronal Mass Ejection / Radiation Storm
        if space_radiation_index > 950 || megawatts_harvested > SOLAR_FLARE_EMERGENCY_WATTS {
            config.emergency_lockout = true;
            emit!(EmergencyHaltEvent {
                collector_id: config.collector_id.clone(),
                radiation_index: space_radiation_index,
                megawatts: megawatts_harvested,
                timestamp: current_time,
                reason: "Parametric Solar Flare Triggered Circuit Breaker".to_string(),
            });
            return Ok(());
        }

        // State Delta Accumulation
        config.total_energy_harvested_mwh = config
            .total_energy_harvested_mwh
            .checked_add(megawatts_harvested)
            .ok_or(HeliosError::MathOverflow)?;

        config.total_compute_flops_exascale = config
            .total_compute_flops_exascale
            .checked_add(exascale_flops_delivered)
            .ok_or(HeliosError::MathOverflow)?;

        config.last_telemetry_timestamp = current_time;

        // Calculate Dynamic Yield Allocation:
        // 1 Token = 1 Kilowatt-Hour Equivalent
        // Formula: (MW * 1000) + (ExaFLOPs * 250)
        let energy_units = megawatts_harvested
            .checked_mul(1000)
            .ok_or(HeliosError::MathOverflow)?;
        let compute_units = exascale_flops_delivered
            .checked_mul(250)
            .ok_or(HeliosError::MathOverflow)?;
        let total_tokens_to_mint = energy_units
            .checked_add(compute_units)
            .ok_or(HeliosError::MathOverflow)?;

        // Execute CPI Mint to Settlement Vault via Token-2022
        let seeds = &[
            CONFIG_SEED,
            &[config.bump],
        ];
        let signer = [&seeds[..]];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.energy_mint.to_account_info(),
            to: ctx.accounts.collector_reserve.to_account_info(),
            authority: ctx.accounts.global_config.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            cpi_accounts,
            &signer,
        );

        token_2022::mint_to(cpi_ctx, total_tokens_to_mint)?;

        emit!(TelemetryIngestedEvent {
            collector_id: config.collector_id.clone(),
            mwh_added: megawatts_harvested,
            flops_added: exascale_flops_delivered,
            tokens_minted: total_tokens_to_mint,
            total_mwh_recorded: config.total_energy_harvested_mwh,
            timestamp: current_time,
        });

        Ok(())
    }

    /// Reset emergency lockout following orbital telemetry verification
    pub fn resume_system_lockout(
        ctx: Context<ManageLockout>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.global_config;
        require_keys_eq!(config.authority, ctx.accounts.authority.key(), HeliosError::UnauthorizedAuthority);
        config.emergency_lockout = false;

        emit!(SystemResumedEvent {
            collector_id: config.collector_id.clone(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// ---------------------------------------------------------------------------------
// Account Layouts & Validation Contexts
// ---------------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(collector_id: String)]
pub struct InitializeAssetStream<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GlobalConfig::LEN,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Trusted Telemetry Signer
    pub telemetry_oracle: AccountInfo<'info>,

    #[account(mut)]
    pub energy_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_2022_program: Program<'info, Token2022>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct IngestTelemetryAndSettle<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = global_config.bump
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub telemetry_oracle: Signer<'info>,

    #[account(
        mut,
        address = global_config.energy_mint
    )]
    pub energy_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = collector_reserve.mint == energy_mint.key() @ HeliosError::InvalidReserveMint
    )]
    pub collector_reserve: InterfaceAccount<'info, TokenAccount>,

    pub token_2022_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct ManageLockout<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = global_config.bump
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub authority: Signer<'info>,
}

// ---------------------------------------------------------------------------------
// On-Chain State Structure
// ---------------------------------------------------------------------------------

#[account]
pub struct GlobalConfig {
    pub authority: Pubkey,                   // 32
    pub telemetry_oracle: Pubkey,            // 32
    pub energy_mint: Pubkey,                 // 32
    pub total_energy_harvested_mwh: u64,     // 8
    pub total_compute_flops_exascale: u64,   // 8
    pub last_telemetry_timestamp: i64,       // 8
    pub base_yield_rate_bps: i16,            // 2
    pub emergency_lockout: bool,             // 1
    pub bump: u8,                            // 1
    pub collector_id: String,                // 4 + 32 = 36
}

impl GlobalConfig {
    pub const LEN: usize = 32 + 32 + 32 + 8 + 8 + 8 + 2 + 1 + 1 + 36;
}

// ---------------------------------------------------------------------------------
// Events & Errors
// ---------------------------------------------------------------------------------

#[event]
pub struct StreamInitializedEvent {
    pub collector_id: String,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TelemetryIngestedEvent {
    pub collector_id: String,
    pub mwh_added: u64,
    pub flops_added: u64,
    pub tokens_minted: u64,
    pub total_mwh_recorded: u64,
    pub timestamp: i64,
}

#[event]
pub struct EmergencyHaltEvent {
    pub collector_id: String,
    pub radiation_index: u32,
    pub megawatts: u64,
    pub timestamp: i64,
    pub reason: String,
}

#[event]
pub struct SystemResumedEvent {
    pub collector_id: String,
    pub timestamp: i64,
}

#[error_code]
pub enum HeliosError {
    #[msg("Collector ID exceeds maximum string length of 32")]
    IdentifierTooLong,
    #[msg("Yield rate specification is out of bounds")]
    InvalidRateConfig,
    #[msg("Unauthorized telemetry oracle signer")]
    UnauthorizedTelemetryOracle,
    #[msg("Telemetry timestamp cannot be in the future")]
    FutureTelemetryTime,
    #[msg("Telemetry stream is stale beyond orbital latency tolerance")]
    StaleTelemetryStream,
    #[msg("System is currently locked down due to an emergency parametric trigger")]
    SystemEmergencyLocked,
    #[msg("Calculated arithmetic overflow")]
    MathOverflow,
    #[msg("Collector reserve account mint mismatch")]
    InvalidReserveMint,
    #[msg("Unauthorized authority caller")]
    UnauthorizedAuthority,
}