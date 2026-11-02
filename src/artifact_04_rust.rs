use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, MintTo, Token2022};
use anchor_spl::token_interface::{Mint, TokenAccount};

declare_id!("HeLioS20501111111111111111111111111111111111");

pub const SWARM_SEED: &[u8] = b"orbital_swarm";
pub const ENERGY_MINT_SEED: &[u8] = b"energy_mint";
pub const COMPUTE_MINT_SEED: &[u8] = b"compute_mint";

#[program]
pub mod helios_2050 {
    use super::*;

    /// Initializes a new Orbital Swarm asset entry with satellite parameters
    pub fn initialize_swarm(
        ctx: Context<InitializeSwarm>,
        satellite_id: String,
        target_orbital_radius_km: u64,
        max_megawatt_capacity: u64,
    ) -> Result<()> {
        require!(satellite_id.len() <= 32, HeliosError::IdentifierTooLong);
        require!(max_megawatt_capacity > 0, HeliosError::InvalidCapacity);

        let swarm_account = &mut ctx.accounts.swarm_account;
        swarm_account.authority = ctx.accounts.authority.key();
        swarm_account.satellite_id = satellite_id;
        swarm_account.orbital_radius_km = target_orbital_radius_km;
        swarm_account.max_megawatt_capacity = max_megawatt_capacity;
        swarm_account.total_energy_harvested_mwh = 0;
        swarm_account.total_qubit_hours_executed = 0;
        swarm_account.last_telemetry_timestamp = Clock::get()?.unix_timestamp;
        swarm_account.energy_mint = ctx.accounts.energy_mint.key();
        swarm_account.compute_mint = ctx.accounts.compute_mint.key();
        swarm_account.bump = ctx.bumps.swarm_account;

        msg!(
            "Helios-2050: Swarm Initialized: {} at radius {} km",
            swarm_account.satellite_id,
            target_orbital_radius_km
        );
        Ok(())
    }

    /// Oracle/Relayer submits verified orbital telemetry and mints corresponding yield tokens
    pub fn submit_orbital_telemetry_and_mint(
        ctx: Context<SubmitTelemetryAndMint>,
        megawatt_hours_produced: u64,
        qubit_hours_produced: u64,
        atmospheric_attenuation_bps: u16, // Basis points (1/100 of 1%)
    ) -> Result<()> {
        let swarm_account = &mut ctx.accounts.swarm_account;
        let clock = Clock::get()?;

        // Telemetry must be strictly forward in time
        require!(
            clock.unix_timestamp > swarm_account.last_telemetry_timestamp,
            HeliosError::StaleTelemetryTimestamp
        );
        require!(
            atmospheric_attenuation_bps <= 10_000,
            HeliosError::InvalidAttenuationFactor
        );

        // Calculate net yield taking atmospheric attenuation into account
        // Net MWh = (MWh * (10000 - attenuation_bps)) / 10000
        let attenuation_factor = 10_000u64.saturating_sub(atmospheric_attenuation_bps as u64);
        let net_megawatts = megawatt_hours_produced
            .checked_mul(attenuation_factor)
            .ok_or(HeliosError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(HeliosError::MathOverflow)?;

        // Update Cumulative Metrics
        swarm_account.total_energy_harvested_mwh = swarm_account
            .total_energy_harvested_mwh
            .checked_add(net_megawatts)
            .ok_or(HeliosError::MathOverflow)?;

        swarm_account.total_qubit_hours_executed = swarm_account
            .total_qubit_hours_executed
            .checked_add(qubit_hours_produced)
            .ok_or(HeliosError::MathOverflow)?;

        swarm_account.last_telemetry_timestamp = clock.unix_timestamp;

        // Dynamic Minting via Token-2022 CPI using Program Derived Address seeds
        let auth_key = swarm_account.authority;
        let bump = swarm_account.bump;
        let seeds: &[&[&[u8]]] = &[&[
            SWARM_SEED,
            auth_key.as_ref(),
            swarm_account.satellite_id.as_bytes(),
            &[bump],
        ]];

        // 1. Mint Net Orbital Energy Credits (Decimals: 6)
        if net_megawatts > 0 {
            let energy_mint_amount = net_megawatts
                .checked_mul(1_000_000)
                .ok_or(HeliosError::MathOverflow)?;

            let cpi_accounts_energy = MintTo {
                mint: ctx.accounts.energy_mint.to_account_info(),
                to: ctx.accounts.recipient_energy_account.to_account_info(),
                authority: ctx.accounts.swarm_account.to_account_info(),
            };
            let cpi_ctx_energy = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts_energy,
                seeds,
            );
            token_2022::mint_to(cpi_ctx_energy, energy_mint_amount)?;
        }

        // 2. Mint Quantum Compute Execution Units (Decimals: 6)
        if qubit_hours_produced > 0 {
            let compute_mint_amount = qubit_hours_produced
                .checked_mul(1_000_000)
                .ok_or(HeliosError::MathOverflow)?;

            let cpi_accounts_compute = MintTo {
                mint: ctx.accounts.compute_mint.to_account_info(),
                to: ctx.accounts.recipient_compute_account.to_account_info(),
                authority: ctx.accounts.swarm_account.to_account_info(),
            };
            let cpi_ctx_compute = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts_compute,
                seeds,
            );
            token_2022::mint_to(cpi_ctx_compute, compute_mint_amount)?;
        }

        emit!(TelemetryIngestedEvent {
            satellite_id: swarm_account.satellite_id.clone(),
            net_energy_mwh: net_megawatts,
            qubit_hours: qubit_hours_produced,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Emergency decommission in case of solar flare or trajectory collision risk
    pub fn trigger_emergency_safe_mode(
        ctx: Context<EmergencySafeMode>,
        reason_code: u8,
    ) -> Result<()> {
        let swarm = &mut ctx.accounts.swarm_account;
        swarm.max_megawatt_capacity = 0; // Halts further mint operations
        emit!(EmergencySafeModeTriggeredEvent {
            satellite_id: swarm.satellite_id.clone(),
            reason_code,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT CONTEXTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(satellite_id: String, target_orbital_radius_km: u64, max_megawatt_capacity: u64)]
pub struct InitializeSwarm<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + SwarmAccount::INIT_SPACE,
        seeds = [SWARM_SEED, authority.key().as_ref(), satellite_id.as_bytes()],
        bump
    )]
    pub swarm_account: Account<'info, SwarmAccount>,

    #[account(
        init,
        payer = authority,
        seeds = [ENERGY_MINT_SEED, swarm_account.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = swarm_account,
        mint::token_program = token_program
    )]
    pub energy_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        seeds = [COMPUTE_MINT_SEED, swarm_account.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = swarm_account,
        mint::token_program = token_program
    )]
    pub compute_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SubmitTelemetryAndMint<'info> {
    #[account(
        mut,
        has_one = authority @ HeliosError::UnauthorizedTelemetryRelayer,
        has_one = energy_mint @ HeliosError::InvalidEnergyMint,
        has_one = compute_mint @ HeliosError::InvalidComputeMint,
    )]
    pub swarm_account: Account<'info, SwarmAccount>,

    #[account(mut)]
    pub energy_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub compute_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = energy_mint,
        token::authority = recipient_owner,
        token::token_program = token_program
    )]
    pub recipient_energy_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = compute_mint,
        token::authority = recipient_owner,
        token::token_program = token_program
    )]
    pub recipient_compute_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Recipient owner address
    pub recipient_owner: AccountInfo<'info>,

    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct EmergencySafeMode<'info> {
    #[account(
        mut,
        has_one = authority @ HeliosError::UnauthorizedTelemetryRelayer
    )]
    pub swarm_account: Account<'info, SwarmAccount>,
    pub authority: Signer<'info>,
}

// -----------------------------------------------------------------------------
// STATE DEFINITIONS
// -----------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct SwarmAccount {
    pub authority: Pubkey,
    #[max_len(32)]
    pub satellite_id: String,
    pub orbital_radius_km: u64,
    pub max_megawatt_capacity: u64,
    pub total_energy_harvested_mwh: u64,
    pub total_qubit_hours_executed: u64,
    pub last_telemetry_timestamp: i64,
    pub energy_mint: Pubkey,
    pub compute_mint: Pubkey,
    pub bump: u8,
}

// -----------------------------------------------------------------------------
// EVENTS & ERRORS
// -----------------------------------------------------------------------------

#[event]
pub struct TelemetryIngestedEvent {
    pub satellite_id: String,
    pub net_energy_mwh: u64,
    pub qubit_hours: u64,
    pub timestamp: i64,
}

#[event]
pub struct EmergencySafeModeTriggeredEvent {
    pub satellite_id: String,
    pub reason_code: u8,
    pub timestamp: i64,
}

#[error_code]
pub enum HeliosError {
    #[msg("Identifier exceeds 32 byte boundary")]
    IdentifierTooLong,
    #[msg("Capacity must be greater than zero")]
    InvalidCapacity,
    #[msg("Stale telemetry timestamp rejected")]
    StaleTelemetryTimestamp,
    #[msg("Atmospheric attenuation exceeds 10,000 bps maximum")]
    InvalidAttenuationFactor,
    #[msg("Arithmetic overflow detected in yield mint calculation")]
    MathOverflow,
    #[msg("Signer is not authorized to submit telemetry for this orbital asset")]
    UnauthorizedTelemetryRelayer,
    #[msg("Mismatch with registered energy mint")]
    InvalidEnergyMint,
    #[msg("Mismatch with registered compute mint")]
    InvalidComputeMint,
}