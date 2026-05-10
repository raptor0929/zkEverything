import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
const port = process.env.PORT ?? 4000;

app.use(express.json());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN,
  })
);

// TODO: wire up /api/chat route (issue 008)

app.listen(port, () => {
  console.log(`agent-backend listening on port ${port}`);
});
