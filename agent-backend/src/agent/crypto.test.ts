import { encrypt, decrypt } from "./crypto";

const KEY = Buffer.alloc(32, 0xab);

describe("AES-256-GCM crypto", () => {
  it("encrypt/decrypt round-trips correctly", () => {
    const plaintext = Buffer.from("hello world secret");
    const ciphertext = encrypt(plaintext, KEY);
    const result = decrypt(ciphertext, KEY);
    expect(result).toEqual(plaintext);
  });

  it("two encryptions of the same input produce different ciphertexts", () => {
    const plaintext = Buffer.from("same input every time");
    const c1 = encrypt(plaintext, KEY);
    const c2 = encrypt(plaintext, KEY);
    expect(c1).not.toBe(c2);
  });

  it("decrypting with wrong key throws", () => {
    const plaintext = Buffer.from("sensitive data");
    const ciphertext = encrypt(plaintext, KEY);
    const wrongKey = Buffer.alloc(32, 0x00);
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });

  it("round-trips a 64-byte Solana secret key", () => {
    const secretKey = Buffer.alloc(64);
    for (let i = 0; i < 64; i++) secretKey[i] = i;
    const ciphertext = encrypt(secretKey, KEY);
    const result = decrypt(ciphertext, KEY);
    expect(result).toEqual(secretKey);
  });
});
