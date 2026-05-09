use anchor_lang::prelude::*;
use anchor_lang::system_program;
use sha3::{Digest, Keccak256};
use solana_secp256k1_recover::secp256k1_recover;

declare_id!("786pocjFvsLKLL4Ly5cYm2e5qsT4GMBvK21Cx97PWK1o");

const DENOMINATION: u64 = 10_000_000; // 0.01 SOL
const ALT_BN128_PAIRING_OUTPUT_LEN: usize = 32;

extern "C" {
    fn sol_alt_bn128_group_op(
        group_op: u64,
        input: *const u8,
        input_size: u64,
        result: *mut u8,
    ) -> u64;
}

// BN254 field prime (big-endian, 32 bytes) — used only for G1 negation.
const FP: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
    0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

// EIP-197 G2 generator constant [X_imag, X_real, Y_imag, Y_real].
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

// Negates a G1 y-coordinate: FP - y (big-endian).
fn negate_fp(y: &[u8; 32]) -> [u8; 32] {
    let mut result = [0u8; 32];
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let d = FP[i] as i16 - y[i] as i16 - borrow;
        result[i] = d.rem_euclid(256) as u8;
        borrow = if d < 0 { 1 } else { 0 };
    }
    result
}

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

    /// Lock 0.01 SOL and register a blinded G1 point and unblinded base point Y
    /// for a given deposit ID.  Y = H(spend_address) is committed here so that
    /// the redeem instruction can verify the BLS pairing without recomputing the
    /// hash-to-curve on-chain (which would require sol_big_mod_exp).
    pub fn deposit(
        ctx: Context<Deposit>,
        _deposit_id: [u8; 20],
        blinded_point: [u8; 64],
        y_point: [u8; 64],
    ) -> Result<()> {
        let record = &mut ctx.accounts.deposit;
        record.blinded_point = blinded_point;
        record.y_point = y_point;
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

    /// Post the mint's blind signature S' on-chain and advance state to Announced.
    /// Permissionless: any fee payer may submit the blind signature.
    pub fn announce(
        ctx: Context<Announce>,
        _deposit_id: [u8; 20],
        mint_sig: [u8; 64],
    ) -> Result<()> {
        let record = &mut ctx.accounts.deposit;
        require!(record.state == 0, VaultError::NotPending);
        record.mint_sig = mint_sig;
        record.state = 1; // Announced
        Ok(())
    }

    /// Redeem a token: verify ECDSA spend proof + BLS pairing, burn the nullifier,
    /// close the deposit PDA, and transfer all SOL to the recipient.
    ///
    /// Y = H(nullifier) was committed to the deposit record at deposit time.
    /// The contract reads it from there and uses it for the BLS pairing check,
    /// avoiding any on-chain hash-to-curve computation.
    ///
    /// Parameters
    /// ----------
    /// recipient     – Solana pubkey that receives the funds
    /// spend_sig     – 65-byte secp256k1 signature: r(32) ‖ s(32) ‖ v(1), v = 27 or 28
    /// nullifier     – 20-byte spend address (revealed here for the first time)
    /// unblinded_sig – 64-byte unblinded BLS signature S = r⁻¹·S' (G1 point, EIP-197)
    /// deposit_id    – 20-byte blind address used to find the deposit PDA
    pub fn redeem(
        ctx: Context<Redeem>,
        recipient: Pubkey,
        spend_sig: [u8; 65],
        nullifier: [u8; 20],
        unblinded_sig: [u8; 64],
        deposit_id: [u8; 20],
    ) -> Result<()> {
        // ── 1. ECDSA: recover signer from spend_sig; assert == nullifier ──────
        let msg_hash: [u8; 32] = {
            let mut h = Keccak256::new();
            h.update(b"Pay to RAW: ");
            h.update(recipient.as_ref());
            h.finalize().into()
        };

        // EVM convention: v ∈ {27, 28} → Solana recovery_id ∈ {0, 1}
        let recovery_id = spend_sig[64].wrapping_sub(27);
        require!(recovery_id <= 1, VaultError::InvalidECDSA);

        let mut sig64 = [0u8; 64];
        sig64.copy_from_slice(&spend_sig[..64]);

        let recovered = secp256k1_recover(&msg_hash, recovery_id, &sig64)
            .map_err(|_| error!(VaultError::InvalidECDSA))?;

        // keccak256(uncompressed-pubkey-64-bytes)[12..] == Ethereum address
        let pub_hash: [u8; 32] = {
            let mut h = Keccak256::new();
            h.update(&recovered.0); // 64-byte uncompressed pubkey (no 0x04 prefix)
            h.finalize().into()
        };
        require!(&pub_hash[12..] == &nullifier, VaultError::InvalidECDSA);

        // ── 2. State check ───────────────────────────────────────────────────
        require!(ctx.accounts.deposit.state == 1, VaultError::NotAnnounced);

        // ── 3. Read Y from deposit record (committed at deposit time) ────────
        let y_point = ctx.accounts.deposit.y_point;
        let y_x: &[u8; 32] = y_point[..32].try_into().unwrap();
        let y_y: &[u8; 32] = y_point[32..].try_into().unwrap();
        let neg_y_y = negate_fp(y_y);

        // ── 4. BLS pairing: e(S, G2_gen) ⊗ e(−Y, mint_pk) == 1 ─────────────
        // Equivalent to e(S, G2_gen) == e(Y, mint_pk).
        let mut pairing_input = [0u8; 384];
        pairing_input[..64].copy_from_slice(&unblinded_sig);         // S
        pairing_input[64..192].copy_from_slice(&g2_gen());           // G2_gen
        pairing_input[192..224].copy_from_slice(y_x);                // −Y.x (unchanged)
        pairing_input[224..256].copy_from_slice(&neg_y_y);           // −Y.y = FP − Y.y
        pairing_input[256..384].copy_from_slice(&ctx.accounts.mint_state.mint_pk); // PK_mint

        let mut pairing_result = [0u8; ALT_BN128_PAIRING_OUTPUT_LEN];
        let ret = unsafe {
            sol_alt_bn128_group_op(
                3,
                pairing_input.as_ptr(),
                384,
                pairing_result.as_mut_ptr(),
            )
        };
        require!(ret == 0, VaultError::InvalidBLS);
        require!(pairing_result[31] == 1, VaultError::InvalidBLS);

        // ── 5. Nullifier PDA init (Anchor creates it; fails if already exists) ─
        // (double-spend protection via `init` on nullifier_record account)

        // ── 6. Close deposit PDA → lamports go to recipient_account ──────────
        // Handled by `close = recipient_account` on the deposit account constraint.

        let _ = deposit_id; // consumed by account seeds, not needed in instruction body
        Ok(())
    }
}

// ── Account contexts ──────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
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

#[derive(Accounts)]
#[instruction(deposit_id: [u8; 20])]
pub struct Announce<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"deposit", deposit_id.as_ref()],
        bump = deposit.bump,
    )]
    pub deposit: Account<'info, DepositRecord>,
}

#[derive(Accounts)]
#[instruction(recipient: Pubkey, spend_sig: [u8; 65], nullifier: [u8; 20], unblinded_sig: [u8; 64], deposit_id: [u8; 20])]
pub struct Redeem<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: receives all redeemed SOL (verified by address constraint)
    #[account(mut, address = recipient)]
    pub recipient_account: UncheckedAccount<'info>,

    #[account(seeds = [b"state"], bump = mint_state.bump)]
    pub mint_state: Account<'info, MintState>,

    #[account(
        mut,
        seeds = [b"deposit", deposit_id.as_ref()],
        bump = deposit.bump,
        close = recipient_account,
    )]
    pub deposit: Account<'info, DepositRecord>,

    #[account(
        init,
        payer = payer,
        space = 8 + NullifierRecord::LEN,
        seeds = [b"nullifier", nullifier.as_ref()],
        bump,
    )]
    pub nullifier_record: Account<'info, NullifierRecord>,

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
    pub y_point: [u8; 64],       // H(spend_address) committed at deposit time
    pub mint_sig: [u8; 64],
    pub state: u8,   // 0 = Pending, 1 = Announced
    pub bump: u8,
}

impl DepositRecord {
    pub const LEN: usize = 64 + 64 + 64 + 1 + 1;
}

#[account]
pub struct NullifierRecord {
    pub bump: u8,
}

impl NullifierRecord {
    pub const LEN: usize = 1;
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum VaultError {
    #[msg("Deposit is not in Pending state")]
    NotPending,
    #[msg("Deposit is not in Announced state")]
    NotAnnounced,
    #[msg("ECDSA recovery failed or address mismatch")]
    InvalidECDSA,
    #[msg("BLS pairing check failed")]
    InvalidBLS,
}
