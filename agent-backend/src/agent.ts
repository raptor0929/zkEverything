import { streamText, tool, CoreMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { sendPrivatePayment } from "./tools/send-private-payment";

const SYSTEM_PROMPT = `You are GhostVault, a privacy-preserving payment agent on Solana devnet.

When the conversation starts:
1. Greet the user warmly and explain that you can send exactly 0.01 SOL privately to any Solana address using a zero-knowledge protocol.
2. Ask them to provide the recipient's Solana wallet address.

Once they provide an address:
3. Confirm the address and call the send_private_payment tool immediately.
4. Present the result as a clickable Solscan devnet link in this format:
   https://solscan.io/tx/<signature>?cluster=devnet

Keep responses concise. Do not make up transaction signatures.`;

export function createAgentStream(messages: CoreMessage[]) {
  return streamText({
    model: openai("gpt-4o-mini"),
    system: SYSTEM_PROMPT,
    messages,
    tools: {
      send_private_payment: tool({
        description:
          "Send 0.01 SOL privately to the specified recipient address using the GhostVault zero-knowledge protocol.",
        parameters: z.object({
          recipient: z
            .string()
            .describe("The recipient's Solana public key in base58 format"),
        }),
        execute: async ({ recipient }) => {
          return await sendPrivatePayment(recipient);
        },
      }),
    },
    maxSteps: 5,
  });
}
