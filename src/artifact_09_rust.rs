use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;
use crate::error::AetherisError;
use crate::state::*;

#[derive(Accounts)]
pub struct TransferHookExecute<'info> {
    #[account(
        seeds = [ORBITAL_REGISTRY_SEED],
        bump = registry.bump
    )]
    pub registry: Account<'info, RegistryConfig>,

    #[account(
        token::mint = registry.photon_mint
    )]
    pub source_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        token::mint = registry.photon_mint
    )]
    pub destination_account: InterfaceAccount<'info, TokenAccount>,

    pub owner: Signer<'info>,
}

pub fn handler(ctx: Context<TransferHookExecute>, amount: u64) -> Result<()> {
    // 2050 Planetary Orbital Congestion & Anti-Monopoly Regulation Check:
    // Single transfers cannot exceed 100,000,000 kWh equivalent (100 GWh) in a single packet
    let max_single_packet: u64 = 100_000_000 * 1_000_000_000;
    require!(amount <= max_single_packet, AetherisError::OrbitalGridCongestion);

    msg!(
        "Token-2022 Transfer Hook verified: {} photons cleared for destination {}",
        amount,
        ctx.accounts.destination_account.key()
    );

    Ok(())
}