use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("GhVt1pV8XFwUmpaxQQGkR3f5pXBuXuNmQJhSsrBHe2TS");

const DENOMINATION: u64 = 10_000_000; // 0.01 SOL

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

    /// Lock 0.01 SOL and register a blinded G1 point for a given deposit ID.
    pub fn deposit(
        ctx: Context<Deposit>,
        _deposit_id: [u8; 20],
        blinded_point: [u8; 64],
    ) -> Result<()> {
        let record = &mut ctx.accounts.deposit;
        record.blinded_point = blinded_point;
        record.mint_sig = [0u8; 64];
        record.state = 0; // Pending
        record.bump = ctx.bumps.deposit;

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.deposit.to_account_info(),
                },
            ),
            DENOMINATION,
        )?;

        Ok(())
    }
}

// ── Account contexts ──────────────────────────────────────────────────────────

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

#[derive(Accounts)]
#[instruction(deposit_id: [u8; 20])]
pub struct Deposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + DepositRecord::LEN,
        seeds = [b"deposit", deposit_id.as_ref()],
        bump,
    )]
    pub deposit: Account<'info, DepositRecord>,

    pub system_program: Program<'info, System>,
}

// ── Account data ──────────────────────────────────────────────────────────────

#[account]
pub struct MintState {
    pub mint_pk: [u8; 128],
    pub bump: u8,
}

impl MintState {
    pub const LEN: usize = 128 + 1;
}

#[account]
pub struct DepositRecord {
    pub blinded_point: [u8; 64],
    pub mint_sig: [u8; 64],
    pub state: u8,   // 0 = Pending, 1 = Announced
    pub bump: u8,
}

impl DepositRecord {
    pub const LEN: usize = 64 + 64 + 1 + 1;
}
