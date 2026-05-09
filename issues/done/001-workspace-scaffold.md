## Parent PRD

`issues/prd.md`

## What to build

Create the `prototype/` Anchor workspace from scratch, reusing toolchain configuration and dependency versions from the existing `solana/` workspace. The workspace must build successfully with an empty program stub. Copy `ghost-library.ts` and `bn254-crypto.ts` from `nozkash/ts/` into `prototype/ts/` as the self-contained crypto foundation for all subsequent TypeScript work.

End state: `anchor build` succeeds, `mcl-wasm` and `@noble/curves` are importable from the prototype's TypeScript, and the project structure is ready to receive instructions and tests.

## Acceptance criteria

- [ ] `prototype/` contains a valid Anchor workspace (`Anchor.toml`, `Cargo.toml`, `package.json`, `tsconfig.json`, `rust-toolchain.toml`)
- [ ] `anchor build` completes without errors from the `prototype/` directory
- [ ] `prototype/ts/ghost-library.ts` and `prototype/ts/bn254-crypto.ts` are copied from `nozkash/ts/`
- [ ] `package.json` includes `mcl-wasm`, `@noble/curves`, `@coral-xyz/anchor`, and mocha/ts-mocha test dependencies
- [ ] `prototype/` has its own `.gitignore` excluding `target/`, `node_modules/`, `.anchor/`, `test-ledger/`
- [ ] The program crate compiles with a single no-op instruction stub (no logic yet)

## Blocked by

None — can start immediately.

## User stories addressed

- User story 19
- User story 20
