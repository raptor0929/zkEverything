use anchor_lang::prelude::*;
use anchor_lang::system_program;
use sha3::{Digest, Keccak256};
use solana_secp256k1_recover::{secp256k1_recover, Secp256k1RecoverError};

declare_id!("64vgvXiXjkDxTzoY6QMRMziKHfwdgM7AyvKdGo5G93sH");

const DENOMINATION: u64 = 10_000_000; // 0.01 SOL
const ALT_BN128_PAIRING_OUTPUT_LEN: usize = 32;

// op_id 0=ADD, 1=SUB, 2=MUL, 3=PAIRING (platform-tools-sdk/sbf/c/inc/sol/alt_bn128.h)
extern "C" {
    fn sol_alt_bn128_group_op(
        group_op: u64,
        input: *const u8,
        input_size: u64,
        result: *mut u8,
    ) -> u64;
}

#[program]
pub mod ghost_vault {
    use super::*;

    /// One-time setup: store the mint BLS public key (G2 point, 128 bytes) in a config PDA.
    pub fn initialize(ctx: Context<Initialize>, pk_mint: [u8; 128]) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.pk_mint = pk_mint;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    /// Benchmark all redeem() primitives without validating results.
    /// CU is measured from computeUnitsConsumed in the tx meta.
    /// Not for production use.
    pub fn bench_redeem(
        ctx: Context<BenchRedeem>,
        recipient: Pubkey,
        _nullifier: [u8; 20],
        sig_r: [u8; 32],
        sig_s: [u8; 32],
        sig_v: u8,
        bls_s: [u8; 64],
        h_nullifier: [u8; 64],
    ) -> Result<()> {
        // keccak256("Pay to RAW: " || recipient)
        let mut hasher = Keccak256::new();
        hasher.update(b"Pay to RAW: ");
        hasher.update(recipient.as_ref());
        let tx_hash: [u8; 32] = hasher.finalize().into();

        // secp256k1_recover
        let mut sig = [0u8; 64];
        sig[..32].copy_from_slice(&sig_r);
        sig[32..].copy_from_slice(&sig_s);
        let _recovered = secp256k1_recover(&tx_hash, sig_v, &sig).ok();

        // keccak256(pubkey) → Ethereum address
        if let Some(recovered) = _recovered {
            let mut h = Keccak256::new();
            h.update(&recovered.0);
            let _pub_hash = h.finalize();
        }

        // BN254 2-pair pairing
        let g2 = g2_gen();
        let mut pairing_input = [0u8; 384];
        pairing_input[..64].copy_from_slice(&bls_s);
        pairing_input[64..192].copy_from_slice(&g2);
        pairing_input[192..256].copy_from_slice(&h_nullifier);
        pairing_input[256..384].copy_from_slice(&ctx.accounts.config.pk_mint);

        let mut pairing_result = [0u8; ALT_BN128_PAIRING_OUTPUT_LEN];
        let ret = unsafe {
            sol_alt_bn128_group_op(3,
                pairing_input.as_ptr(),
                pairing_input.len() as u64,
                pairing_result.as_mut_ptr(),
            )
        };
        msg!("pairing_syscall_ret: {}", ret);           // 0 = success
        msg!("pairing_result: {}", pairing_result[31]); // 1 = valid BLS, 0 = invalid

        // SOL transfer: vault PDA → recipient
        let vault_bump = ctx.bumps.vault;
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient.to_account_info(),
                },
                &[&[b"vault", &[vault_bump]]],
            ),
            DENOMINATION,
        )?;

        Ok(())
    }

    /// Production redeem — requires valid ECDSA + BLS proofs.
    pub fn redeem(
        ctx: Context<Redeem>,
        recipient: Pubkey,
        nullifier: [u8; 20],
        sig_r: [u8; 32],
        sig_s: [u8; 32],
        sig_v: u8,
        bls_s: [u8; 64],
        h_nullifier: [u8; 64],
    ) -> Result<()> {
        let mut hasher = Keccak256::new();
        hasher.update(b"Pay to RAW: ");
        hasher.update(recipient.as_ref());
        let tx_hash: [u8; 32] = hasher.finalize().into();

        let mut sig = [0u8; 64];
        sig[..32].copy_from_slice(&sig_r);
        sig[32..].copy_from_slice(&sig_s);

        let recovered = secp256k1_recover(&tx_hash, sig_v, &sig)
            .map_err(|_e: Secp256k1RecoverError| error!(VaultError::InvalidECDSA))?;

        let mut h = Keccak256::new();
        h.update(&recovered.0);
        let pub_hash = h.finalize();
        require!(&pub_hash[12..] == nullifier.as_ref(), VaultError::InvalidECDSA);

        let g2 = g2_gen();
        let mut pairing_input = [0u8; 384];
        pairing_input[..64].copy_from_slice(&bls_s);
        pairing_input[64..192].copy_from_slice(&g2);
        pairing_input[192..256].copy_from_slice(&h_nullifier);
        pairing_input[256..384].copy_from_slice(&ctx.accounts.config.pk_mint);

        let mut pairing_result = [0u8; ALT_BN128_PAIRING_OUTPUT_LEN];
        let ret = unsafe {
            sol_alt_bn128_group_op(3,
                pairing_input.as_ptr(),
                pairing_input.len() as u64,
                pairing_result.as_mut_ptr(),
            )
        };
        require!(ret == 0, VaultError::InvalidBLS);
        require!(pairing_result[31] == 1, VaultError::InvalidBLS);

        let vault_bump = ctx.bumps.vault;
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient.to_account_info(),
                },
                &[&[b"vault", &[vault_bump]]],
            ),
            DENOMINATION,
        )?;

        emit!(Redeemed { nullifier, recipient });
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
        space = 8 + Config::LEN,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: SOL-holding vault PDA.
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BenchRedeem<'info> {
    #[account(mut)]
    pub redeemer: Signer<'info>,

    /// CHECK: receives SOL.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: vault PDA holds denomination SOL.
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    _recipient: Pubkey,
    nullifier: [u8; 20],
)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub redeemer: Signer<'info>,

    /// CHECK: receives SOL.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: vault PDA.
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: UncheckedAccount<'info>,

    /// One PDA per spent nullifier — prevents double-spend.
    #[account(
        init,
        payer = redeemer,
        space = 8 + NullifierRecord::LEN,
        seeds = [b"nullifier", nullifier.as_ref()],
        bump,
    )]
    pub nullifier_account: Account<'info, NullifierRecord>,

    pub system_program: Program<'info, System>,
}

// ── Accounts ──────────────────────────────────────────────────────────────────

#[account]
pub struct Config {
    pub pk_mint: [u8; 128],
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 128 + 1;
}

#[account]
pub struct NullifierRecord {
    pub bump: u8,
}

impl NullifierRecord {
    pub const LEN: usize = 1;
}

// ── Events & Errors ───────────────────────────────────────────────────────────

#[event]
pub struct Redeemed {
    pub nullifier: [u8; 20],
    pub recipient: Pubkey,
}

#[error_code]
pub enum VaultError {
    #[msg("ECDSA recovery failed or nullifier mismatch")]
    InvalidECDSA,
    #[msg("BLS pairing check failed")]
    InvalidBLS,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn g2_gen() -> [u8; 128] {
    [
        0x19, 0x8e, 0x93, 0x93, 0x92, 0x0d, 0x48, 0x3a,
        0x72, 0x60, 0xbf, 0xb7, 0x31, 0xfb, 0x5d, 0x25,
        0xf1, 0xaa, 0x49, 0x33, 0x35, 0xa9, 0xe7, 0x12,
        0x97, 0xe4, 0x85, 0xb7, 0xae, 0xf3, 0x12, 0xc2,
        0x18, 0x00, 0xde, 0xef, 0x12, 0x1f, 0x1e, 0x76,
        0x42, 0x6a, 0x00, 0x66, 0x5e, 0x5c, 0x44, 0x79,
        0x67, 0x43, 0x22, 0xd4, 0xf7, 0x5e, 0xda, 0xdd,
        0x46, 0xde, 0xbd, 0x5c, 0xd9, 0x92, 0xf6, 0xed,
        0x09, 0x06, 0x89, 0xd0, 0x58, 0x5f, 0xf0, 0x75,
        0xec, 0x9e, 0x99, 0xad, 0x69, 0x0c, 0x33, 0x95,
        0xbc, 0x4b, 0x31, 0x33, 0x70, 0xb3, 0x8e, 0xf3,
        0x55, 0xac, 0xda, 0xdc, 0xd1, 0x22, 0x97, 0x5b,
        0x12, 0xc8, 0x5e, 0xa5, 0xdb, 0x8c, 0x6d, 0xeb,
        0x4a, 0xab, 0x71, 0x80, 0x8d, 0xcb, 0x40, 0x8f,
        0xe3, 0xd1, 0xe7, 0x69, 0x0c, 0x43, 0xd3, 0x7b,
        0x4c, 0xe6, 0xcc, 0x01, 0x66, 0xfa, 0x7d, 0xaa,
    ]
}
