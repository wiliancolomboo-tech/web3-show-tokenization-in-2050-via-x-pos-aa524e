use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;
use state::*;

declare_id!("AeTH5o1anA2o5oEnergyTokenEngine11111111111");

#[program]
pub mod aetheris_2050 {
    use super::*;

    pub fn initialize_registry(ctx: Context<InitializeRegistry>, photon_mint: Pubkey) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.photon_mint = photon_mint;
        registry.total_active_arrays = 0;
        registry.total_energy_harvested_gwh = 0;
        registry.bump = ctx.bumps.registry;
        msg!("AETHERIS 2050 Registry initialized. Mint: {}", photon_mint);
        Ok(())
    }

    pub fn initialize_asset(
        ctx: Context<InitializeAsset>,
        asset_id: [u8; 16],
        orbital_sector: u16,
    ) -> Result<()> {
        instructions::initialize_asset::handler(ctx, asset_id, orbital_sector)
    }

    pub fn update_telemetry(
        ctx: Context<UpdateTelemetry>,
        asset_id: [u8; 16],
        delta_energy_kwh: u64,
        instantaneous_output_kw: u32,
        in_penumbra: bool,
    ) -> Result<()> {
        instructions::update_telemetry::handler(
            ctx,
            asset_id,
            delta_energy_kwh,
            instantaneous_output_kw,
            in_penumbra,
        )
    }

    pub fn execute_transfer_hook(ctx: Context<TransferHookExecute>, amount: u64) -> Result<()> {
        instructions::transfer_hook::handler(ctx, amount)
    }
}

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(
        init,
        payer = authority,
        space = RegistryConfig::LEN,
        seeds = [ORBITAL_REGISTRY_SEED],
        bump
    )]
    pub registry: Account<'info, RegistryConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}