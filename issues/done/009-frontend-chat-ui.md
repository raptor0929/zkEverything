## Parent PRD

`issues/prd-agent-platform.md`

## What to build

Implement the `agent-ui/` Next.js frontend — a single chat page that streams from the `agent-backend/` service. The page uses the Vercel AI SDK `useChat` hook pointed at `NEXT_PUBLIC_BACKEND_URL + '/api/chat'`. It renders a scrollable message list, a text input, a send button, and a loading spinner while the stream is in progress.

When the agent's final message contains a Solscan URL, it is rendered as a clickable anchor tag (not plain text). All other messages render as plain text. The layout is usable on both mobile and desktop.

This slice can be built and visually verified against the stub backend from `008`. The UI does not need to know whether the backend is returning a real or fake signature.

## Acceptance criteria

- [ ] Opening `http://localhost:3000` shows the chat interface
- [ ] Messages from the agent stream in token-by-token (not appearing all at once)
- [ ] A spinner or loading indicator is visible while `isLoading === true`
- [ ] Solscan URLs in agent messages render as clickable links
- [ ] The input field is disabled while a message is in flight
- [ ] The page is usable on a 375px wide mobile screen (no horizontal overflow)
- [ ] `NEXT_PUBLIC_BACKEND_URL` controls which backend the frontend calls
- [ ] `npm run build` completes without TypeScript errors

## Blocked by

- Blocked by `issues/007-project-scaffolding.md`

## User stories addressed

- User story 1
- User story 6
- User story 7
- User story 9
- User story 13
