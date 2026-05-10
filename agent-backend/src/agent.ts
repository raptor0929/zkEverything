import { streamText, tool, CoreMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { Keypair } from "@solana/web3.js";
import { sendPrivatePayment } from "./tools/send-private-payment";
import { getSupabaseAdmin } from "./agent/supabase";
import { decrypt } from "./agent/crypto";

const SYSTEM_PROMPT = `You are zkEverything, a privacy-preserving payment agent on Solana devnet.

Follow this exact sequence every time the user wants to send a transaction:

1. Greet briefly (one sentence). Then immediately call collect_destination.
2. After the user provides a Solana address, call collect_amount.
3. After the user selects or states an amount, call show_funding_address with the amountSol they chose.
4. Wait. When the user says "funds received", call send_private_payment with the recipient address from step 2.
5. If send_private_payment returns a signature, call payment_complete with that signature.
6. If send_private_payment returns an error, relay the error as one natural sentence. Do not show JSON.

Rules:
- Never skip steps or call tools out of order.
- Never make up transaction signatures or pubkeys.
- Keep all text responses brief and conversational.
- A valid Solana address is any base58 string between 32 and 44 characters long. Accept it and proceed — do NOT try to validate it yourself. The blockchain will handle invalid addresses.
- After the user provides any string that looks like a wallet address (32–44 non-whitespace characters), immediately call collect_amount.`;

export function createAgentStream(userId: string, messages: CoreMessage[]) {
  return streamText({
    model: openai("gpt-4o-mini"),
    system: SYSTEM_PROMPT,
    messages,
    tools: {
      collect_destination: tool({
        description:
          "Signal the UI to show the destination address input helper. Call this immediately after greeting.",
        parameters: z.object({}),
        execute: async () => ({}),
      }),

      collect_amount: tool({
        description:
          "Signal the UI to show the amount preset buttons (1 SOL, 0.1 SOL, 0.01 SOL). Call this after the user confirms their destination address.",
        parameters: z.object({}),
        execute: async () => ({}),
      }),

      show_funding_address: tool({
        description:
          "Signal the UI to display the agent funding address card so the user can send SOL to it. Call this after the user selects an amount.",
        parameters: z.object({
          amountSol: z
            .number()
            .describe("The amount the user selected, e.g. 0.01"),
        }),
        execute: async ({ amountSol }) => {
          const supabase = getSupabaseAdmin();
          const { data } = await supabase
            .from("agents")
            .select("pubkey")
            .eq("user_id", userId)
            .single();
          const agentPubkey: string = data?.pubkey ?? "unknown";
          return { agentPubkey, amountSol };
        },
      }),

      send_private_payment: tool({
        description:
          "Execute the full private payment flow (deposit → announce → redeem) using the user's agent keypair. Call only after receiving 'funds received' from the user.",
        parameters: z.object({
          recipient: z
            .string()
            .describe("The recipient's Solana public key in base58 format"),
        }),
        execute: async ({ recipient }) => {
          const supabase = getSupabaseAdmin();
          const { data } = await supabase
            .from("agents")
            .select("encrypted_keypair")
            .eq("user_id", userId)
            .single();

          if (!data?.encrypted_keypair) {
            return { error: "Agent keypair not found. Please create an agent first." };
          }

          const encKey = process.env.AGENT_ENCRYPTION_KEY;
          if (!encKey) throw new Error("AGENT_ENCRYPTION_KEY not set");
          const secretKey = decrypt(data.encrypted_keypair, Buffer.from(encKey, "hex"));
          const agentKeypair = Keypair.fromSecretKey(secretKey);

          return await sendPrivatePayment(agentKeypair, recipient);
        },
      }),

      payment_complete: tool({
        description:
          "Signal the UI to show the Done state with the Solscan link. Call this after send_private_payment returns a signature.",
        parameters: z.object({
          signature: z.string().describe("The redeem transaction signature"),
        }),
        execute: async ({ signature }) => ({ signature }),
      }),
    },
    maxSteps: 10,
  });
}
