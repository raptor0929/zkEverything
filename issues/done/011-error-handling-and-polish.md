## Parent PRD

`issues/prd-agent-platform.md`

## What to build

Harden the end-to-end flow with recipient address validation, friendly error mapping, and UI polish. This is the last slice before the platform is demo-ready.

**Backend — `solana/errors.ts`:**
Implement the error mapping function that converts raw exception messages into user-facing strings per the PRD's error table:

| Raw error substring | User-facing message |
|---|---|
| `Nullifier already spent` | "This payment token has already been used. Please start a new transfer." |
| `Relayer wallet low on funds` | "The relayer is temporarily out of funds. Please try again shortly." |
| `Invalid recipient pubkey` | "That doesn't look like a valid Solana address. Please double-check and try again." |
| RPC timeout / network error | "Solana devnet is slow right now. Please try again in a moment." |
| Unknown | "Something went wrong with your transfer. Please try again." |

**Backend — tool handler:**
Validate the `recipient` parameter as a base58 Solana pubkey before calling any Solana RPC. Wrap the full payment flow in try/catch and pass caught errors through the error mapper. Return mapped error strings as tool result content so the agent can relay them naturally in conversation.

**Frontend — `components/Chat.tsx`:**
Ensure error messages returned by the tool are displayed in the chat without any special formatting (plain text is correct — the agent paraphrases them). Verify the Solscan link is still rendered as a clickable anchor when the happy path succeeds. Confirm mobile layout holds at 375px.

## Acceptance criteria

- [ ] Providing a non-base58 string as the recipient produces the invalid address message in chat
- [ ] Each mapped error case from the PRD produces the correct user-facing message (testable via `solana/errors.ts` unit tests)
- [ ] An unknown error produces the generic fallback message, not a raw stack trace
- [ ] The agent's reply to a failed payment is a natural sentence, not a raw JSON blob
- [ ] The Solscan link in a successful payment is a clickable `<a>` tag in the UI
- [ ] The chat layout shows no horizontal scrollbar on a 375px wide screen
- [ ] All TypeScript types compile cleanly (`npm run build` in both services)

## Blocked by

- Blocked by `issues/009-frontend-chat-ui.md`
- Blocked by `issues/010-solana-payment-flow.md`

## User stories addressed

- User story 5
- User story 8
- User story 16
