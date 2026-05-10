## Parent PRD

`issues/prd-agent-platform.md`

## What to build

Create the two service folders — `agent-backend/` and `agent-ui/` — at the root of `dev3pack/` with all boilerplate needed for a TypeScript Express server and a Next.js app respectively. No business logic yet. Both services should be installable and startable after this slice.

`agent-backend/` structure:
- `package.json` with dependencies: `express`, `ai`, `@ai-sdk/openai`, `@coral-xyz/anchor`, `@solana/web3.js`, `mcl-wasm`, `@noble/curves`, `ethereum-cryptography`, `dotenv`, `cors`
- `tsconfig.json` targeting Node 18+
- `.env.example` documenting all required secrets: `OPENAI_API_KEY`, `MINT_SK`, `RELAYER_KEYPAIR`, `RPC_URL`, `PORT`, `ALLOWED_ORIGIN`
- `src/` directory with empty placeholder files matching the module layout from the PRD: `server.ts`, `agent.ts`, `tools/send-private-payment.ts`, `solana/client.ts`, `solana/errors.ts`

`agent-ui/` structure:
- `package.json` with dependencies: `next`, `react`, `react-dom`, `ai`
- `tsconfig.json` for Next.js App Router
- `.env.example` documenting `NEXT_PUBLIC_BACKEND_URL`
- `app/` directory with empty placeholder files: `page.tsx`, `components/Chat.tsx`

## Acceptance criteria

- [ ] `cd agent-backend && npm install` completes without errors
- [ ] `cd agent-ui && npm install` completes without errors
- [ ] Both `.env.example` files document every secret/env var needed by the PRD
- [ ] `agent-backend/src/` contains the module stubs from the PRD's module layout
- [ ] `agent-ui/app/` contains the component stubs from the PRD's module layout
- [ ] Neither folder is committed with a real `.env` file
- [ ] Both folders have `.gitignore` entries for `node_modules/`, `.env`, and build output

## Blocked by

None — can start immediately.

## User stories addressed

- User story 12
- User story 17
