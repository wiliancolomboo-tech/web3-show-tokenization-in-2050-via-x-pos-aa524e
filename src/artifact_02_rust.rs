use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, Token2022, TokenAccount, TransferChecked};

declare_id!("Aeth205011111111111111111111111111111111111");

pub const MAX_TELEMETRY_LATENCY_SLOTS: u64 = 500_000; // ~3.5 days at 400ms slots
pub const DEGRADATION_PENALTY_BPS: u64 = 250;          // 2.50% yield reduction per degradation point
pub const BPS_DENOMINATOR: u64 = 10_000;

#[program]
pub mod aether_2050 {
    use super::*;

    /// Initializes a new physical infrastructure asset (e.g., Orbital Solar Array, Fusion Grid)
    pub fn initialize_asset(
        ctx: Context<InitializeAsset>,
        asset_id: String,
        hardware_pubkey: Pubkey,
        name: String,
        base_yield_rate_per_slot: u64,
        nominal_capacity_kw: u64,
    ) -> Result<()> {
        require!(asset_id.len() <= 32, AetherError::StringTooLong);
        require!(name.len() <= 64, AetherError::StringTooLong);
        require!(base_yield_rate_per_slot > 0, AetherError::InvalidParameter);
        require!(nominal_capacity_kw > 0, AetherError::InvalidParameter);

        let asset = &mut ctx.accounts.asset_account;
        asset.authority = ctx.accounts.authority.key();
        asset.hardware_pubkey = hardware_pubkey;
        asset.asset_id = asset_id;
        asset.name = name;
        asset.base_yield_rate_per_slot = base_yield_rate_per_slot;
        asset.nominal_capacity_kw = nominal_capacity_kw;
        asset.current_efficiency_bps = 10_000; // 100.00% at genesis
        asset.cumulative_energy_kwh = 0;
        asset.cumulative_yield_distributed = 0;
        asset.last_telemetry_slot = Clock::get()?.slot;
        asset.status = AssetStatus::Active;
        asset.bump = ctx.bumps.asset_account;
        asset.vault_bump = ctx.bumps.yield_vault;

        emit!(AssetInitializedEvent {
            asset_id: asset.asset_id.clone(),
            hardware_pubkey,
            nominal_capacity_kw,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Ingests physical IoT/Satellite hardware telemetry and streams calculated yield tokens
    pub fn record_telemetry_and_stream_yield(
        ctx: Context<RecordTelemetryAndStreamYield>,
        energy_generated_kwh: u64,
        efficiency_bps: u16,
        hardware_signature: [u8; 64],
    ) -> Result<()> {
        let current_slot = Clock::get()?.slot;
        let asset = &mut ctx.accounts.asset_account;

        require!(asset.status == AssetStatus::Active, AetherError::AssetNotActive);
        require!(efficiency_bps <= 10_000, AetherError::InvalidEfficiencyMetric);

        // Verify that the caller or signature matches the authorized physical hardware enclave
        require_keys_eq!(
            ctx.accounts.telemetry_signer.key(),
            asset.hardware_pubkey,
            AetherError::UnauthorizedHardwareSigner
        );

        // Guard against replay or retro-slot ingestion
        let elapsed_slots = current_slot
            .checked_sub(asset.last_telemetry_slot)
            .ok_or(AetherError::MathUnderflow)?;

        require!(elapsed_slots > 0, AetherError::TelemetryAlreadyProcessed);
        require!(
            elapsed_slots <= MAX_TELEMETRY_LATENCY_SLOTS,
            AetherError::TelemetryLagExceeded
        );

        // Dynamic yield calculation: BaseRate * ElapsedSlots * (Efficiency / 10000)
        let unadjusted_yield = (asset.base_yield_rate_per_slot as u128)
            .checked_mul(elapsed_slots as u128)
            .ok_or(AetherError::MathOverflow)?;

        let dynamic_yield = unadjusted_yield
            .checked_mul(efficiency_bps as u128)
            .ok_or(AetherError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(AetherError::MathOverflow)? as u64;

        // Update physical state parameters
        asset.current_efficiency_bps = efficiency_bps;
        asset.cumulative_energy_kwh = asset
            .cumulative_energy_kwh
            .checked_add(energy_generated_kwh)
            .ok_or(AetherError::MathOverflow)?;
        asset.last_telemetry_slot = current_slot;
        asset.cumulative_yield_distributed = asset
            .cumulative_yield_distributed
            .checked_add(dynamic_yield)
            .ok_or(AetherError::MathOverflow)?;

        // Autonomic degradation check
        if efficiency_bps < 4_000 {
            // Hardware has degraded below 40% operational capacity
            asset.status = AssetStatus::Degraded;
            emit!(AssetDegradedEvent {
                asset_id: asset.asset_id.clone(),
                efficiency_bps,
                slot: current_slot,
            });
        }

        // Execute streaming distribution transfer to the investor treasury
        if dynamic_yield > 0 {
            require!(
                ctx.accounts.yield_vault.amount >= dynamic_yield,
                AetherError::InsufficientYieldVaultBalance
            );

            let asset_id_bytes = asset.asset_id.as_bytes();
            let seeds = &[
                b"yield_vault",
                asset_id_bytes,
                &[asset.vault_bump],
            ];
            let signer_seeds = &[&seeds[..]];

            let cpi_accounts = TransferChecked {
                from: ctx.accounts.yield_vault.to_account_info(),
                mint: ctx.accounts.yield_mint.to_account_info(),
                to: ctx.accounts.investor_recipient.to_account_info(),
                authority: ctx.accounts.yield_vault.to_account_info(),
            };

            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

            token_interface::transfer_checked(
                cpi_ctx,
                dynamic_yield,
                ctx.accounts.yield_mint.decimals,
            )?;
        }

        emit!(TelemetryRecordedEvent {
            asset_id: asset.asset_id.clone(),
            energy_generated_kwh,
            efficiency_bps,
            yield_distributed: dynamic_yield,
            slot: current_slot,
            signature_prefix: hardware_signature[0..8].try_into().unwrap_or([0u8; 8]),
        });

        Ok(())
    }

    /// Autonomic Decommissioning trigger if an orbital asset ceases communication
    pub fn trigger_parametrically_decommission(
        ctx: Context<TriggerDecommission>,
    ) -> Result<()> {
        let current_slot = Clock::get()?.slot;
        let asset = &mut ctx.accounts.asset_account;

        let elapsed = current_slot
            .checked_sub(asset.last_telemetry_slot)
            .ok_or(AetherError::MathUnderflow)?;

        // Only allowed if machine exceeded absolute telemetry timeout
        require!(
            elapsed > MAX_TELEMETRY_LATENCY_SLOTS,
            AetherError::AssetNotEligibleForDecommission
        );

        asset.status = AssetStatus::Decommissioned;

        // Drain remaining unallocated reserves back to authorized emergency salvage escrow
        let remaining_balance = ctx.accounts.yield_vault.amount;
        if remaining_balance > 0 {
            let asset_id_bytes = asset.asset_id.as_bytes();
            let seeds = &[
                b"yield_vault",
                asset_id_bytes,
                &[asset.vault_bump],
            ];
            let signer_seeds = &[&seeds[..]];

            let cpi_accounts = TransferChecked {
                from: ctx.accounts.yield_vault.to_account_info(),
                mint: ctx.accounts.yield_mint.to_account_info(),
                to: ctx.accounts.salvage_vault.to_account_info(),
                authority: ctx.accounts.yield_vault.to_account_info(),
            };

            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

            token_interface::transfer_checked(
                cpi_ctx,
                remaining_balance,
                ctx.accounts.yield_mint.decimals,
            )?;
        }

        emit!(AssetDecommissionedEvent {
            asset_id: asset.asset_id.clone(),
            salvage_amount: remaining_balance,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT VALIDATION STRUCTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(asset_id: String)]
pub struct InitializeAsset<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + AssetRegistry::INIT_SPACE,
        seeds = [b"asset_registry", asset_id.as_bytes()],
        bump
    )]
    pub asset_account: Account<'info, AssetRegistry>,

    pub yield_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        seeds = [b"yield_vault", asset_id.as_bytes()],
        bump,
        token::mint = yield_mint,
        token::authority = yield_vault,
        token::token_program = token_program
    )]
    pub yield_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordTelemetryAndStreamYield<'info> {
    pub telemetry_signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"asset_registry", asset_account.asset_id.as_bytes()],
        bump = asset_account.bump,
    )]
    pub asset_account: Account<'info, AssetRegistry>,

    #[account(mut)]
    pub yield_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"yield_vault", asset_account.asset_id.as_bytes()],
        bump = asset_account.vault_bump,
        token::mint = yield_mint,
        token::authority = yield_vault,
        token::token_program = token_program
    )]
    pub yield_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = yield_mint,
        token::token_program = token_program
    )]
    pub investor_recipient: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, Token2022>,
}

#[derive(Accounts)]
pub struct TriggerDecommission<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"asset_registry", asset_account.asset_id.as_bytes()],
        bump = asset_account.bump,
    )]
    pub asset_account: Account<'info, AssetRegistry>,

    #[account(mut)]
    pub yield_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"yield_vault", asset_account.asset_id.as_bytes()],
        bump = asset_account.vault_bump,
        token::mint = yield_mint,
        token::authority = yield_vault,
        token::token_program = token_program
    )]
    pub yield_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = yield_mint,
        token::token_program = token_program
    )]
    pub salvage_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, Token2022>,
}

// -----------------------------------------------------------------------------
// STATE DEFINITIONS
// -----------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AssetStatus {
    Active,
    Degraded,
    Decommissioned,
}

#[account]
#[derive(InitSpace)]
pub struct AssetRegistry {
    pub authority: Pubkey,
    pub hardware_pubkey: Pubkey,
    #[max_len(32)]
    pub asset_id: String,
    #[max_len(64)]
    pub name: String,
    pub base_yield_rate_per_slot: u64,
    pub nominal_capacity_kw: u64,
    pub current_efficiency_bps: u16,
    pub cumulative_energy_kwh: u64,
    pub cumulative_yield_distributed: u64,
    pub last_telemetry_slot: u64,
    pub status: AssetStatus,
    pub bump: u8,
    pub vault_bump: u8,
}

// -----------------------------------------------------------------------------
// EVENTS & ERRORS
// -----------------------------------------------------------------------------

#[event]
pub struct AssetInitializedEvent {
    pub asset_id: String,
    pub hardware_pubkey: Pubkey,
    pub nominal_capacity_kw: u64,
    pub timestamp: i64,
}

#[event]
pub struct TelemetryRecordedEvent {
    pub asset_id: String,
    pub energy_generated_kwh: u64,
    pub efficiency_bps: u16,
    pub yield_distributed: u64,
    pub slot: u64,
    pub signature_prefix: [u8; 8],
}

#[event]
pub struct AssetDegradedEvent {
    pub asset_id: String,
    pub efficiency_bps: u16,
    pub slot: u64,
}

#[event]
pub struct AssetDecommissionedEvent {
    pub asset_id: String,
    pub salvage_amount: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum AetherError {
    #[msg("String exceeds maximum permitted length")]
    StringTooLong,
    #[msg("Provided parameter value is invalid")]
    InvalidParameter,
    #[msg("Asset is not in Active status")]
    AssetNotActive,
    #[msg("Efficiency BPS exceeds maximum allowable 10,000")]
    InvalidEfficiencyMetric,
    #[msg("Signer does not match authorized hardware enclave pubkey")]
    UnauthorizedHardwareSigner,
    #[msg("Telemetry packet already processed for this or prior slot")]
    TelemetryAlreadyProcessed,
    #[msg("Telemetry packet latency exceeds threshold")]
    TelemetryLagExceeded,
    #[msg("Insufficient yield vault reserves to stream rewards")]
    InsufficientYieldVaultBalance,
    #[msg("Asset has not exceeded lag timeout; cannot decommission")]
    AssetNotEligibleForDecommission,
    #[msg("Numerical math overflow occurred")]
    MathOverflow,
    #[msg("Numerical math underflow occurred")]
    MathUnderflow,
}