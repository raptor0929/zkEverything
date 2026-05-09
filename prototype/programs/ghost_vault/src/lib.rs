use anchor_lang::prelude::*;

declare_id!("GhVt1pV8XFwUmpaxQQGkR3f5pXBuXuNmQJhSsrBHe2TS");

#[program]
pub mod ghost_vault {
    use super::*;

    pub fn noop(_ctx: Context<Noop>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Noop<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
