use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(asset_id: [u8; 16])]
pub struct InitializeAsset<'info> {
    #[account(
        mut,
        seeds = [ORBITAL_REGISTRY_SEED],
        bump = registry.bump
    )]
    pub registry: Account<'info, RegistryConfig>,

    #[account(
        init,
        payer = authority,
        space = HarvesterAsset::LEN,
        seeds = [HARVESTER_ASSET_SEED, asset_id.as_ref()],
        bump
    )]
    pub harvester: Account<'info, HarvesterAsset>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub enclave_attestor: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeAsset>,
    asset_id: [u8; 16],
    orbital_sector: u16,
) -> Result<()> {
    let harvester = &mut ctx.accounts.harvester;
    let registry = &mut ctx.accounts.registry;

    harvester.asset_id = asset_id;
    harvester.orbital_sector = orbital_sector;
    harvester.enclave_attestor = ctx.accounts.enclave_attestor.key();
    harvester.cumulative_energy_mwh = 0;
    harvester.instantaneous_output_kw = 0;
    harvester.last_telemetry_timestamp = Clock::get()?.unix_timestamp;
    harvester.in_penumbra = false;
    harvester.active = true;
    harvester.bump = ctx.bumps.harvester;

    registry.total_active_arrays = registry.total_active_arrays.checked_add(1).unwrap();

    msg!("Asset {:?} initialized in orbital sector {}", asset_id, orbital_sector);
    Ok(())
}