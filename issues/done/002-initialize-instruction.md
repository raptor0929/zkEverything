## Parent PRD

`issues/prd.md`

## What to build

Implement the `initialize` instruction in the Anchor program and a `generateMintKeypair()` function in a new `prototype/ts/mint.ts` module. The instruction creates a `MintState` PDA at seeds `[b"state"]` and stores the 128-byte BLS G2 public key. Write an Anchor test that generates a fresh mint BLS keypair, calls `initialize`, and asserts the PDA was created with the correct public key bytes.

End state: a passing Anchor test that proves a mint BLS keypair can be registered on-chain.

## Acceptance criteria

- [ ] `initialize(mint_pk: [u8; 128])` instruction creates `MintState` PDA at `[b"state"]`
- [ ] `MintState` account stores `mint_pk: [u8; 128]` and `bump: u8`
- [ ] Calling `initialize` twice fails (PDA already exists)
- [ ] `prototype/ts/mint.ts` exports `generateMintKeypair()` returning `{ sk, pk }` using `mcl-wasm`
- [ ] `pk` is the G2 BLS public key serialized as 128 bytes in EIP-197 limb order (`[X_imag, X_real, Y_imag, Y_real]`)
- [ ] Anchor test: generates mint keypair → calls `initialize` → fetches `MintState` PDA → asserts `mint_pk` bytes match
- [ ] Test uses `anchor test` against localnet (not bankrun)

## Blocked by

- Blocked by `issues/001-workspace-scaffold.md`

## User stories addressed

- User story 2
- User story 13
