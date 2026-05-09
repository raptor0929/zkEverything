import { keccak256 } from 'ethereum-cryptography/keccak.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import * as mcl from 'mcl-wasm';
import {
    hashToCurveBN254, multiplyBN254,
    modularInverse, verifyPairingBN254, getG2Generator, CURVE_ORDER,
} from './bn254-crypto';

// ==============================================================================
// ERROR HIERARCHY
// ==============================================================================

export class GhostError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class DerivationError extends GhostError {}

export class VerificationError extends GhostError {}


// ==============================================================================
// TYPES
// ==============================================================================

/**
 * A secp256k1 keypair derived deterministically from the master seed.
 *
 * Both token keypairs (spend and blind) share this structure:
 *   spend keypair → address is the nullifier (revealed at redemption)
 *   blind keypair → address is the deposit ID (revealed at deposit)
 */
export interface TokenKeypair {
    priv:         Uint8Array;   // 32-byte private key
    pubHex:       string;       // 0x-prefixed uncompressed public key (65 bytes, starts with 04)
    address:      string;       // 0x-prefixed Ethereum address (20 bytes)
    addressBytes: Uint8Array;   // raw 20 bytes
}

export interface TokenSecrets {
    spend: TokenKeypair;
    blind: TokenKeypair;
}

export interface BlindedPoints {
    Y: mcl.G1;   // H(spend_address) — unblinded hash-to-curve
    B: mcl.G1;   // r·Y             — blinded point sent to mint
}

export interface MintKeypair {
    skMint: bigint;
    pkMint: mcl.G2;
}

export interface RedemptionProof {
    msgHash:            Uint8Array;
    signatureObj:       Uint8Array;   // raw 64-byte compact r||s
    compactHex:         string;       // 128-char hex of signatureObj
    recoveryBit:        0 | 1;        // v = recoveryBit + 27 in the 65-byte spend signature
    pubKeyUncompressed: Uint8Array;   // 65-byte uncompressed secp256k1 pubkey
}

// ==============================================================================
// HELPERS
// ==============================================================================

/** Derives the Ethereum address from a 65-byte uncompressed public key. */
function pubKeyToAddress(pubKeyUncompressed: Uint8Array): string {
    return '0x' + Buffer.from(
        keccak256(pubKeyUncompressed.slice(1)).slice(-20)
    ).toString('hex');
}

/**
 * Derives a secp256k1 TokenKeypair from a domain label and base material.
 * Domain labels: "spend", "blind"  (mirrors Python's b"spend" / b"blind").
 */
function deriveKeypair(domain: string, baseMaterial: Uint8Array): TokenKeypair {
    const priv            = keccak256(new Uint8Array([...Buffer.from(domain), ...baseMaterial]));
    const pubUncompressed = secp256k1.getPublicKey(priv, false);  // 65 bytes, includes 0x04 prefix
    const pubHex          = '0x' + Buffer.from(pubUncompressed).toString('hex');
    const address         = pubKeyToAddress(pubUncompressed);
    const addressBytes    = Buffer.from(address.slice(2), 'hex');

    return { priv, pubHex, address, addressBytes };
}

/**
 * Derives the BLS blinding scalar r from the blind keypair's private key.
 * Mirrors Python: Scalar(int.from_bytes(blind.priv.to_bytes(), "big") % curve_order)
 */
function toBlsScalar(priv: Uint8Array): bigint {
    return BigInt('0x' + Buffer.from(priv).toString('hex')) % CURVE_ORDER;
}

// ==============================================================================
// 1. CORE CRYPTOGRAPHY UTILS
// ==============================================================================

export function hashToCurve(messageBytes: Uint8Array): mcl.G1 {
    return hashToCurveBN254(messageBytes);
}

export function generateMintKeypair(): MintKeypair {
    const skBytes = secp256k1.utils.randomPrivateKey();
    const skMint  = BigInt('0x' + Buffer.from(skBytes).toString('hex')) % CURVE_ORDER;

    const g2 = getG2Generator();
    const skFr = new mcl.Fr();
    skFr.setStr(skMint.toString(10), 10);

    const pkMint = mcl.mul(g2, skFr) as mcl.G2;
    return { skMint, pkMint };
}

// ==============================================================================
// 2. CLIENT OPERATIONS (User Wallet)
// ==============================================================================

/**
 * Deterministically derives both token keypairs for a given index.
 *
 *   spend keypair: address = nullifier (revealed only at redemption)
 *   blind keypair: address = deposit ID (submitted with deposit tx)
 *                  priv as BN254 scalar = blinding factor r
 *
 * Mirrors Python's derive_token_secrets().
 *
 * Throws DerivationError for invalid inputs.
 */
export function deriveTokenSecrets(masterSeed: Uint8Array, tokenIndex: number): TokenSecrets {
    if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 0xFFFFFFFF) {
        throw new DerivationError(
            `tokenIndex must be a non-negative 32-bit integer, got ${tokenIndex}`
        );
    }

    // DataView ensures correct 32-bit big-endian encoding — Uint8Array constructor
    // would silently truncate indices >= 256, breaking parity with Python.
    const indexBuf = new ArrayBuffer(4);
    new DataView(indexBuf).setUint32(0, tokenIndex, false);
    const baseMaterial = keccak256(
        new Uint8Array([...masterSeed, ...new Uint8Array(indexBuf)])
    );

    return {
        spend: deriveKeypair('spend', baseMaterial),
        blind: deriveKeypair('blind', baseMaterial),
    };
}

/** Convenience accessors matching the Python compat properties on TokenSecrets. */
export function getSpendPriv(secrets: TokenSecrets): Uint8Array    { return secrets.spend.priv; }
export function getSpendAddress(secrets: TokenSecrets): string      { return secrets.spend.address; }
export function getSpendAddressBytes(secrets: TokenSecrets): Uint8Array { return secrets.spend.addressBytes; }
export function getDepositId(secrets: TokenSecrets): string         { return secrets.blind.address; }
export function getR(secrets: TokenSecrets): bigint                 { return toBlsScalar(secrets.blind.priv); }

export function blindToken(spendAddressBytes: Uint8Array, r: bigint): BlindedPoints {
    const Y = hashToCurve(spendAddressBytes);
    const B = multiplyBN254(Y, r);
    return { Y, B };
}

export function unblindSignature(S_prime: mcl.G1, r: bigint): mcl.G1 {
    const r_inv = modularInverse(r, CURVE_ORDER);
    return multiplyBN254(S_prime, r_inv);
}

// ==============================================================================
// 3. MINT OPERATIONS
// ==============================================================================

/** Returns S' = sk·B. Mirrors Python's mint_blind_sign(). */
export function mintBlindSign(B: mcl.G1, skMint: bigint): mcl.G1 {
    return multiplyBN254(B, skMint);
}

// ==============================================================================
// 4. REDEMPTION PROOF
// ==============================================================================

/**
 * Generates the anti-MEV ECDSA signature binding the token to a destination.
 * Mirrors Python's generate_redemption_proof().
 *
 * The message hash MUST match the Solidity contract's redemptionMessageHash():
 *   keccak256(abi.encodePacked("Pay to RAW: ", recipient))
 * which is "Pay to RAW: " (12 bytes) + raw 20-byte address = 32 bytes total.
 *
 * Uses @noble/curves v2.x API:
 *   - sign() with { format: 'recovered' } returns 65 bytes: [recoveryBit, ...r(32), ...s(32)]
 */
export async function generateRedemptionProof(
    spendPriv: Uint8Array,
    destinationAddress: string,
): Promise<RedemptionProof> {
    // Match Solidity: keccak256(abi.encodePacked("Pay to RAW: ", recipient))
    const addrBytes = Buffer.from(destinationAddress.replace('0x', ''), 'hex');
    const prefix    = Buffer.from('Pay to RAW: ', 'utf-8');  // 12 bytes
    const msgHash   = keccak256(new Uint8Array([...prefix, ...addrBytes]));

    const pubKeyUncompressed = secp256k1.getPublicKey(spendPriv, false);  // 65 bytes with 0x04

    // @noble/curves v2.x sign() with format: 'recovered'
    // Returns 65 bytes: [recovery_bit, r(32), s(32)]
    const sigRecovered: Uint8Array = secp256k1.sign(msgHash, spendPriv, {
        lowS: true,
        prehash: false,
        format: 'recovered',
    });

    // Extract recovery bit (first byte) and compact sig (remaining 64 bytes)
    const recoveryBit  = sigRecovered[0] as 0 | 1;
    const signatureObj = sigRecovered.slice(1); // 64-byte compact r||s
    const compactHex   = Buffer.from(signatureObj).toString('hex');

    return { msgHash, signatureObj, compactHex, recoveryBit, pubKeyUncompressed };
}

// ==============================================================================
// 4b. SOLANA-SPECIFIC REDEMPTION PROOF
// ==============================================================================

/**
 * Builds the 65-byte spend signature for a Solana redeem instruction.
 * Message = keccak256("Pay to RAW: " || recipientPubkeyBytes[32])
 * Returns sig65 = r(32) ‖ s(32) ‖ v(1) with v = recoveryBit + 27 (EVM convention).
 */
export function generateSolanaSpendSig(
    spendPriv: Uint8Array,
    recipientPubkeyBytes: Uint8Array, // 32-byte Solana pubkey
): Uint8Array {
    const prefix   = Buffer.from('Pay to RAW: ', 'utf-8'); // 12 bytes
    const msgHash  = keccak256(new Uint8Array([...prefix, ...recipientPubkeyBytes]));

    const sigResult = secp256k1.sign(msgHash, spendPriv, {
        lowS: true,
        prehash: false,
        format: 'recovered',
    }) as unknown as Uint8Array;

    // format:'recovered' → [recoveryBit(1), r(32), s(32)]
    const recoveryBit = sigResult[0]; // 0 or 1
    const rsBytes     = sigResult.slice(1); // 64 bytes r‖s

    const sig65 = new Uint8Array(65);
    sig65.set(rsBytes, 0);
    sig65[64] = recoveryBit + 27; // EVM convention (27 or 28)
    return sig65;
}

// ==============================================================================
// 4c. RELAY CLIENT
// ==============================================================================

export interface RelayPayload {
    recipient:     string;   // base58 Solana pubkey
    spend_sig:     string;   // hex 65 bytes
    nullifier:     string;   // hex 20 bytes
    unblinded_sig: string;   // hex 64 bytes
    deposit_id:    string;   // hex 20 bytes
}

/**
 * Builds the JSON payload to POST to a GhostVault relayer's /relay endpoint.
 * The relayer will sign and broadcast the redeem transaction — the user's wallet
 * never appears on-chain during the redemption, completing the privacy cycle.
 */
export function buildRelayPayload(
    secrets:      TokenSecrets,
    sPrime:       import('mcl-wasm').G1,   // blind sig from announce record
    r:            bigint,
    recipientB58: string,                  // base58 Solana pubkey of destination
    recipientBytes: Uint8Array,            // 32-byte raw pubkey (for ECDSA msg)
    serializeG1Fn: (p: import('mcl-wasm').G1) => Uint8Array,
): RelayPayload {
    const S = unblindSignature(sPrime, r);
    const sig65 = generateSolanaSpendSig(secrets.spend.priv, recipientBytes);

    return {
        recipient:     recipientB58,
        spend_sig:     Buffer.from(sig65).toString('hex'),
        nullifier:     Buffer.from(secrets.spend.addressBytes).toString('hex'),
        unblinded_sig: Buffer.from(serializeG1Fn(S)).toString('hex'),
        deposit_id:    Buffer.from(secrets.blind.addressBytes).toString('hex'),
    };
}

/**
 * Sends a relay payload to the relayer and returns the transaction signature.
 * Throws if the relayer responds with an error.
 */
export async function sendToRelayer(
    relayerUrl: string,
    payload:    RelayPayload,
): Promise<string> {
    const res = await fetch(`${relayerUrl}/relay`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
    });
    const json = await res.json() as { signature?: string; error?: string };
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json.signature!;
}

// ==============================================================================
// 5. VERIFICATION
// ==============================================================================

export function verifyBlsPairing(S: mcl.G1, Y: mcl.G1, pkMint: mcl.G2): boolean {
    return verifyPairingBN254(S, Y, pkMint);
}

/**
 * Simulates EVM ecrecover — derives the signer address from the proof's
 * stored public key to verify the signature, then checks the address matches.
 *
 * Throws VerificationError for structurally invalid input (wrong hex length).
 * Returns false for cryptographically invalid signatures.
 * Mirrors Python's verify_ecdsa_mev_protection().
 */
export function verifyEcdsaMevProtection(
    proof: RedemptionProof,
    expectedAddressHex: string,
): boolean {
    if (proof.compactHex.length !== 128) {
        throw new VerificationError(
            `compactHex must be 128 hex chars (64 bytes), got ${proof.compactHex.length}`
        );
    }

    try {
        // Mirrors Python verify_ecdsa_mev_protection and the contract's ecrecover check:
        //   1. Verify signature validity against the known spend public key
        //   2. Confirm that public key hashes to the expected nullifier address
        // Both must pass — same as ecrecover returning expectedAddressHex.
        if (!secp256k1.verify(proof.signatureObj, proof.msgHash, proof.pubKeyUncompressed, { prehash: false })) {
            return false;
        }
        return pubKeyToAddress(proof.pubKeyUncompressed).toLowerCase() === expectedAddressHex.toLowerCase();
    } catch {
        return false;
    }
}
