use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{self, Token2022},
    token_interface::{Mint, TokenAccount},
};

declare_id!("Astr0G2050111111111111111111111111111111111");

pub const SCALING_FACTOR: u128 = 1_000_000_000_000; // 1e12 fixed-point scale
pub const MAX_TELEMETRY_LATENCY_SLOTS: u64 = 150; // Max ~60 seconds drift

#[program]
pub mod astrogrid_2050 {
    use super::*;

    /// Initialize a newly commissioned orbital Dyson-swarm sub-collector
    pub fn initialize_orbital_collector(
        ctx: Context<InitializeCollector>,
        array_id: u64,
        total_capacity_mwh: u64,
        base_yield_bps: u16,
    ) -> Result<()> {
        let collector = &mut ctx.accounts.collector_account;
        collector.authority = ctx.accounts.authority.key();
        collector.array_id = array_id;
        collector.total_capacity_mwh = total_capacity_mwh;
        collector.allocated_capacity_mwh = 0;
        collector.base_yield_bps = base_yield_bps;
        collector.last_telemetry_slot = Clock::get()?.slot;
        collector.orbital_flux_multiplier = 10_000; // 1.0x baseline in basis points
        collector.bump = ctx.bumps.collector_account;
        collector.mint_bump = ctx.bumps.energy_mint;

        emit!(CollectorInitializedEvent {
            array_id,
            capacity_mwh: total_capacity_mwh,
            authority: collector.authority,
        });

        Ok(())
    }

    /// Attest incoming orbital solar telemetry from zero-knowledge oracle relays
    pub fn attest_orbital_telemetry(
        ctx: Context<AttestTelemetry>,
        array_id: u64,
        irradiance_flux_index: u32, // Relative index (10,000 = 100% nominal)
        beam_efficiency_bps: u16,    // Ground downlink laser/microwave efficiency
    ) -> Result<()> {
        let collector = &mut ctx.accounts.collector_account;
        let clock = Clock::get()?;

        require!(
            clock.slot >= collector.last_telemetry_slot,
            AstroGridError::StaleTelemetrySlot
        );
        require!(
            clock.slot - collector.last_telemetry_slot <= MAX_TELEMETRY_LATENCY_SLOTS,
            AstroGridError::TelemetryLatencyExceeded
        );
        require!(beam_efficiency_bps <= 10_000, AstroGridError::InvalidBeamEfficiency);

        // Compute effective yield adjustment factor: (Flux * BeamEfficiency) / 10,000
        let effective_multiplier = ((irradiance_flux_index as u64)
            .checked_mul(beam_efficiency_bps as u64)
            .ok_or(AstroGridError::MathOverflow)?)
            .checked_div(10_000)
            .ok_or(AstroGridError::MathOverflow)?;

        collector.orbital_flux_multiplier = effective_multiplier as u32;
        collector.last_telemetry_slot = clock.slot;

        emit!(TelemetryAttestedEvent {
            array_id,
            irradiance_flux_index,
            beam_efficiency_bps,
            effective_multiplier: collector.orbital_flux_multiplier,
            slot: clock.slot,
        });

        Ok(())
    }

    /// Mint fractionalized Energy Capacity Tokens (MWh) backed by reserve collateral
    pub fn mint_energy_capacity(
        ctx: Context<MintEnergyCapacity>,
        mwh_amount: u64,
    ) -> Result<()> {
        let collector = &mut ctx.accounts.collector_account;

        let available_mwh = collector
            .total_capacity_mwh
            .checked_sub(collector.allocated_capacity_mwh)
            .ok_or(AstroGridError::CapacityExceeded)?;

        require!(mwh_amount <= available_mwh, AstroGridError::CapacityExceeded);

        collector.allocated_capacity_mwh = collector
            .allocated_capacity_mwh
            .checked_add(mwh_amount)
            .ok_or(AstroGridError::MathOverflow)?;

        // Execute PDA signed minting under Token-2022
        let array_id_bytes = collector.array_id.to_le_bytes();
        let seeds = &[
            b"energy-mint".as_ref(),
            array_id_bytes.as_ref(),
            &[collector.mint_bump],
        ];
        let signer = [&seeds[..]];

        let cpi_accounts = token_2022::MintTo {
            mint: ctx.accounts.energy_mint.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.energy_mint.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &signer,
        );

        token_2022::mint_to(cpi_ctx, mwh_amount)?;

        emit!(EnergyCapacityMintedEvent {
            array_id: collector.array_id,
            recipient: ctx.accounts.recipient.key(),
            mwh_minted: mwh_amount,
        });

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT VALIDATION CONTEXTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(array_id: u64)]
pub struct InitializeCollector<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + OrbitalCollectorState::INIT_SPACE,
        seeds = [b"collector", array_id.to_le_bytes().as_ref()],
        bump
    )]
    pub collector_account: Account<'info, OrbitalCollectorState>,

    #[account(
        init,
        payer = authority,
        seeds = [b"energy-mint", array_id.to_le_bytes().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = energy_mint,
        mint::token_program = token_program
    )]
    pub energy_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
#[instruction(array_id: u64)]
pub struct AttestTelemetry<'info> {
    #[account(
        mut,
        seeds = [b"collector", array_id.to_le_bytes().as_ref()],
        bump = collector_account.bump,
        has_one = authority @ AstroGridError::UnauthorizedTelemetryOracle
    )]
    pub collector_account: Account<'info, OrbitalCollectorState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct MintEnergyCapacity<'info> {
    #[account(
        mut,
        seeds = [b"collector", collector_account.array_id.to_le_bytes().as_ref()],
        bump = collector_account.bump,
    )]
    pub collector_account: Account<'info, OrbitalCollectorState>,

    #[account(
        mut,
        seeds = [b"energy-mint", collector_account.array_id.to_le_bytes().as_ref()],
        bump = collector_account.mint_bump,
    )]
    pub energy_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = energy_mint,
        token::authority = recipient,
        token::token_program = token_program
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub recipient: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
}

// -----------------------------------------------------------------------------
// STATE DEFINITIONS
// -----------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct OrbitalCollectorState {
    pub authority: Pubkey,          // 32
    pub array_id: u64,              // 8
    pub total_capacity_mwh: u64,    // 8
    pub allocated_capacity_mwh: u64,// 8
    pub base_yield_bps: u16,        // 2
    pub orbital_flux_multiplier: u32,// 4
    pub last_telemetry_slot: u64,   // 8
    pub bump: u8,                   // 1
    pub mint_bump: u8,              // 1
}

// -----------------------------------------------------------------------------
// EVENTS & ERRORS
// -----------------------------------------------------------------------------

#[event]
pub struct CollectorInitializedEvent {
    pub array_id: u64,
    pub capacity_mwh: u64,
    pub authority: Pubkey,
}

#[event]
pub struct TelemetryAttestedEvent {
    pub array_id: u64,
    pub irradiance_flux_index: u32,
    pub beam_efficiency_bps: u16,
    pub effective_multiplier: u32,
    pub slot: u64,
}

#[event]
pub struct EnergyCapacityMintedEvent {
    pub array_id: u64,
    pub recipient: Pubkey,
    pub mwh_minted: u64,
}

#[error_code]
pub enum AstroGridError {
    #[msg("Stale telemetry slot attestation sequence")]
    StaleTelemetrySlot,
    #[msg("Telemetry attestation latency exceeds safe operational bound")]
    TelemetryLatencyExceeded,
    #[msg("Downlink beam efficiency value is out of bounds (> 10000 bps)")]
    InvalidBeamEfficiency,
    #[msg("Photovoltaic capacity limit reached for this orbital cluster")]
    CapacityExceeded,
    #[msg("Signer is not authorized to attest orbital telemetry")]
    UnauthorizedTelemetryOracle,
    #[msg("Arithmetic overflow detected in state transition computation")]
    MathOverflow,
}