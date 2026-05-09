use anchor_lang::prelude::*;

declare_id!("GhVt1pV8XFwUmpaxQQGkR3f5pXBuXuNmQJhSsrBHe2TS");

#[program]
pub mod ghost_vault {
    use super::*;

    /// Store the mint BLS public key (G2 point, 128 bytes EIP-197 order) in a PDA.
    pub fn initialize(ctx: Context<Initialize>, mint_pk: [u8; 128]) -> Result<()> {
        let state = &mut ctx.accounts.mint_state;
        state.mint_pk = mint_pk;
        state.bump = ctx.bumps.mint_state;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + MintState::LEN,
        seeds = [b"state"],
        bump,
    )]
    pub mint_state: Account<'info, MintState>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct MintState {
    pub mint_pk: [u8; 128],
    pub bump: u8,
}

impl MintState {
    pub const LEN: usize = 128 + 1;
}
