import express from "express";
import { createHash, randomUUID } from "node:crypto";

// A tiny pretend payment provider. NOT Stripe, NOT Paystack.
// It only copies the idea: same Idempotency-Key + same body = same answer.

type Charge = { id: string; orderId: string; amount: number; currency: string };
type SavedResult = { bodyHash: string; status: number; body: unknown };

const charges: Charge[] = [];
const idempotencyStore = new Map<string, SavedResult>();
let slowResponsesLeft = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hashBody = (body: unknown) =>
  createHash("sha256").update(JSON.stringify(body)).digest("hex");

export const provider = express();
provider.use(express.json());

provider.post("/v1/charges", async (req, res) => {
  const key = req.get("Idempotency-Key");
  const bodyHash = hashBody(req.body);

  if (key) {
    const saved = idempotencyStore.get(key);
    if (saved && saved.bodyHash !== bodyHash) {
      res.status(422).json({ error: "Idempotency-Key was already used with a different body" });
      return;
    }
    if (saved) {
      res.set("Idempotent-Replayed", "true").status(saved.status).json(saved.body);
      return;
    }
  }

  const { orderId, amount, currency } = req.body as Omit<Charge, "id">;
  const charge: Charge = { id: `ch_${randomUUID().slice(0, 8)}`, orderId, amount, currency };
  charges.push(charge); // 💸 money has moved

  if (key) idempotencyStore.set(key, { bodyHash, status: 201, body: charge });

  if (slowResponsesLeft > 0) {
    slowResponsesLeft--;
    await sleep(3000); // the "network is bad" part: charged, but the answer is late
  }
  res.status(201).json(charge);
});

// Test helpers so we can see what happened
provider.get("/v1/charges", (_req, res) => {
  res.json({ count: charges.length, charges });
});

provider.post("/__test/slow", (req, res) => {
  slowResponsesLeft = Number(req.query.times ?? 1);
  res.json({ slowResponsesLeft });
});
