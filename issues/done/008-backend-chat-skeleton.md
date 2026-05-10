## Parent PRD

`issues/prd-agent-platform.md`

## What to build

Implement the `agent-backend/` Express server with a working `/api/chat` streaming endpoint. The agent uses Vercel AI SDK `streamText` with OpenAI and a `send_private_payment` tool whose handler returns a hardcoded fake transaction signature. The full conversation flow — greet, collect recipient address, call tool, return result — works end-to-end against a real OpenAI model, but no Solana transactions are made yet.

The system prompt instructs the agent to:
1. Greet the user and state upfront that it sends exactly 0.01 SOL privately
2. Ask for the recipient Solana address
3. Confirm the address and call the tool
4. Present the result as a Solscan devnet link

The stub tool handler returns:
```
{ signature: "STUB_TX_SIGNATURE_REPLACE_IN_009" }
```

The server listens on `PORT` from env, responds with `toDataStreamResponse()` so the Vercel AI SDK frontend can parse the stream, and sets CORS headers allowing `ALLOWED_ORIGIN` from env.

## Acceptance criteria

- [ ] `POST /api/chat` returns a valid Vercel AI SDK data stream response
- [ ] The agent greets the user and asks for a recipient address without prompting
- [ ] When given a recipient address, the agent calls `send_private_payment` with the address as `recipient`
- [ ] The tool response is formatted into a Solscan devnet URL in the agent's reply
- [ ] The server starts with `npm run dev` and `npm run start`
- [ ] CORS allows requests from the value of `ALLOWED_ORIGIN` env var
- [ ] `.env.example` values are sufficient to run the server (with a real `OPENAI_API_KEY`)
- [ ] The fake signature round-trip is verifiable with `curl` or a REST client

## Blocked by

- Blocked by `issues/007-project-scaffolding.md`

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 7
- User story 11
- User story 14
- User story 15
