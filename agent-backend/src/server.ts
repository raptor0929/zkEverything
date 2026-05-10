import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { CoreMessage } from "ai";
import { createAgentStream } from "./agent";
import { bn254Ready } from "./lib/bn254-init"; // triggers WASM load at startup

bn254Ready.catch((err) => console.error("BN254 init failed:", err));

const app = express();
const port = process.env.PORT ?? 4000;

app.use(express.json());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN ?? "*",
  })
);

app.post("/api/chat", async (req: Request, res: Response) => {
  const { messages } = req.body as { messages: CoreMessage[] };

  try {
    const result = createAgentStream(messages ?? []);
    result.pipeDataStreamToResponse(res);
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`agent-backend listening on port ${port}`);
});
