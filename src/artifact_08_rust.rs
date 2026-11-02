use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, MintTo};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::error::AetherisError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(asset_id: [u8; 16])]
pub struct UpdateTelemetry<'info> {
    #[account(
        mut,
        seeds = [ORBITAL_REGISTRY_SEED],
        bump = registry.bump
    )]
    pub registry: Account<'info, RegistryConfig>,

    #[account(
        mut,
        seeds = [HARVESTER_ASSET_SEED, asset_id.as_ref()],
        bump = harvester.bump,
        has_one = enclave_attestor @ AetherisError::UnauthorizedEnclave
    )]
    pub harvester: Account<'info, HarvesterAsset>,

    pub enclave_attestor: Signer<'info>,

    #[account(
        mut,
        address = registry.photon_mint
    )]
    pub photon_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = photon_mint,
        token::authority = recipient
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    pub recipient: SystemAccount<'info>,

    pub token_2022_program: Interface<'info, TokenInterface>,
}

pub fn handler(
    ctx: Context<UpdateTelemetry>,
    asset_id: [u8; 16],
    delta_energy_kwh: u64,
    instantaneous_output_kw: u32,
    in_penumbra: bool,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let harvester = &mut ctx.accounts.harvester;
    let registry = &mut ctx.accounts.registry;

    require!(harvester.active, AetherisError::AssetInactive);

    // Theoretical maximum physical photon capture check (100 MW per sector block)
    require!(instantaneous_output_kw <= 100_000, AetherisError::ThermodynamicYieldViolation);

    if in_penumbra {
        require!(instantaneous_output_kw == 0, AetherisError::ArrayInPenumbraLock);
    }

    let time_delta = now.saturating_sub(harvester.last_telemetry_timestamp);
    require!(time_delta >= 0 && time_delta <= 3600, AetherisError::TelemetryClockDrift);

    // Update Telemetry Metrics
    harvester.last_telemetry_timestamp = now;
    harvester.instantaneous_output_kw = instantaneous_output_kw;
    harvester.in_penumbra = in_penumbra;

    let delta_mwh = delta_energy_kwh / 1_000;
    harvester.cumulative_energy_mwh = harvester
        .cumulative_energy_mwh
        .checked_add(delta_mwh)
        .unwrap();

    registry.total_energy_harvested_gwh = registry
        .total_energy_harvested_gwh
        .checked_add((delta_mwh / 1_000) as u128)
        .unwrap();

    // 1 kWh = 10^9 base photon units (decimals = 9)
    let tokens_to_mint = delta_energy_kwh.checked_mul(1_000_000_000).unwrap();

    if tokens_to_mint > 0 {
        let registry_bump = registry.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[ORBITAL_REGISTRY_SEED, &[registry_bump]]];

        token_2022::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_2022_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.photon_mint.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: registry.to_account_info(),
                },
                signer_seeds,
            ),
            tokens_to_mint,
        )?;
    }

    msg!(
        "Array {:?} reported {} kWh. Tokens minted: {}",
        asset_id,
        delta_energy_kwh,
        tokens_to_mint
    );

    Ok(())
}