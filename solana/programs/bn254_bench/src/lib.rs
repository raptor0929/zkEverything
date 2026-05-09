use anchor_lang::prelude::*;

declare_id!("89MH5PySAtYjj7Bd2pYYSZtjgqQMNn6cjUUt6K8x3VF5");

const ALT_BN128_PAIRING_OUTPUT_LEN: usize = 32;
const ALT_BN128_MUL_OUTPUT_LEN: usize = 64;

// sol_alt_bn128_group_op: unified BN254 syscall (SIMD-0070).
// op_id 0=ADD, 1=SUB, 2=MUL, 3=PAIRING (from platform-tools-sdk/sbf/c/inc/sol/alt_bn128.h).
// The old sol_alt_bn128_pairing was removed; pairing is now op_id=3 of this syscall.
extern "C" {
    fn sol_alt_bn128_group_op(
        group_op: u64,
        input: *const u8,
        input_size: u64,
        result: *mut u8,
    ) -> u64;
}

#[program]
pub mod bn254_bench {
    use super::*;

    /// Benchmark a 2-pair BN254 pairing check.
    /// CU is measured from computeUnitsConsumed in the tx meta (total tx minus ~3k overhead).
    /// Uses G2_gen as pk_mint so pairing_result=0, but CU cost is identical to a valid proof.
    pub fn bench_pairing(
        _ctx: Context<BenchCtx>,
        g1_s: [u8; 64],
        g1_h: [u8; 64],
    ) -> Result<()> {
        let g2 = g2_gen();

        let mut input = [0u8; 384];
        input[..64].copy_from_slice(&g1_s);
        input[64..192].copy_from_slice(&g2);
        input[192..256].copy_from_slice(&g1_h);
        input[256..384].copy_from_slice(&g2);

        let mut result = [0u8; ALT_BN128_PAIRING_OUTPUT_LEN];
        let ret = unsafe {
            sol_alt_bn128_group_op(3, input.as_ptr(), input.len() as u64, result.as_mut_ptr())
        };

        require!(ret == 0, BenchError::PairingFailed);
        msg!("pairing_result: {}", result[31]); // 1 = valid BLS sig, 0 = invalid (expected here)

        Ok(())
    }

    /// Benchmark a BN254 G1 scalar multiplication (op_id=1).
    pub fn bench_g1_mul(
        _ctx: Context<BenchCtx>,
        g1: [u8; 64],
        scalar: [u8; 32],
    ) -> Result<()> {
        let mut input = [0u8; 96];
        input[..64].copy_from_slice(&g1);
        input[64..].copy_from_slice(&scalar);

        let mut result = [0u8; ALT_BN128_MUL_OUTPUT_LEN];
        let ret = unsafe {
            sol_alt_bn128_group_op(2, input.as_ptr(), input.len() as u64, result.as_mut_ptr())
        };

        require!(ret == 0, BenchError::G1MulFailed);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct BenchCtx {}

#[error_code]
pub enum BenchError {
    #[msg("BN254 pairing syscall returned non-zero error code")]
    PairingFailed,
    #[msg("BN254 G1 mul syscall returned non-zero error code")]
    G1MulFailed,
}

// BN254 G2 generator in EIP-197 wire format: x_imag || x_real || y_imag || y_real
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
