import * as mcl from 'mcl-wasm';
import { getG2Generator, padHex64 } from './bn254-crypto';

function hexToBytes32(hex: string): Uint8Array {
    return new Uint8Array(Buffer.from(padHex64(hex), 'hex'));
}

/**
 * Serializes a G2 point to 128 bytes in BN254 limb order: [X_imag, X_real, Y_imag, Y_real].
 * mcl getStr(16) order: "1 X_real X_imag Y_real Y_imag"
 */
export function serializeG2(pk: mcl.G2): Uint8Array {
    const parts = pk.getStr(16).split(' ');
    const buf = new Uint8Array(128);
    buf.set(hexToBytes32(parts[2]),  0);  // X_imag
    buf.set(hexToBytes32(parts[1]), 32);  // X_real
    buf.set(hexToBytes32(parts[4]), 64);  // Y_imag
    buf.set(hexToBytes32(parts[3]), 96);  // Y_real
    return buf;
}

/** Generates a fresh mint BLS keypair using mcl-wasm. */
export function generateMintKeypair(): { sk: mcl.Fr; pk: mcl.G2 } {
    const g2 = getG2Generator();
    const sk = new mcl.Fr();
    sk.setByCSPRNG();
    const pk = mcl.mul(g2, sk) as mcl.G2;
    return { sk, pk };
}

/**
 * Serializes a G1 point to 64 bytes: [X (32 bytes), Y (32 bytes)].
 * mcl getStr(16) order: "1 X Y"
 */
export function serializeG1(point: mcl.G1): Uint8Array {
    const parts = point.getStr(16).split(' ');
    const buf = new Uint8Array(64);
    buf.set(hexToBytes32(parts[1]),  0);  // X
    buf.set(hexToBytes32(parts[2]), 32);  // Y
    return buf;
}

/** Computes S' = sk · B (blind signature). */
export function blindSign(sk: mcl.Fr, B: mcl.G1): mcl.G1 {
    return mcl.mul(B, sk) as mcl.G1;
}
