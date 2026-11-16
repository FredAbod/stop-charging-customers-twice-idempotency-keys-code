import express from "express";
import { createHash, randomUUID } from "node:crypto";

// A tiny pretend payment provider. NOT Stripe, NOT Paystack.
// It only copies the idea: same Idempotency-Key + same body = same answer.

type Charge = { id: string; orderId: string; amount: number; currency: string };
type SavedResult = { bodyHash: string; status: number; body: unknown };

const charges: Charge[] = [];
const idempotencyStore = new Map<string, SavedResult>();
let slowResponsesLeft = 0;
let crashesLeft = 0;
let crashAfterCharging = true;

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
  const crash = crashesLeft > 0;
  // The money moves on a normal request, or when we crash AFTER charging
  const moneyMoves = !crash || crashAfterCharging;
  if (moneyMoves) charges.push(charge); // 💸 money has moved

  if (crash) {
    // The "server error" part: something broke (maybe after the money moved, maybe before).
    // Like Stripe, we SAVE this 500 under the key, so retries get the same 500.
    crashesLeft--;
    const error = { error: "Internal server error" };
    if (key) idempotencyStore.set(key, { bodyHash, status: 500, body: error });
    res.status(500).json(error);
    return;
  }

  if (key) idempotencyStore.set(key, { bodyHash, status: 201, body: charge });

  if (slowResponsesLeft > 0) {
    slowResponsesLeft--;
    await sleep(3000); // the "network is bad" part: charged, but the answer is late
  }
  res.status(201).json(charge);
});

// Look up charges, optionally for one order (like searching by your orderId in metadata)
provider.get("/v1/charges", (req, res) => {
  const orderId = req.query.orderId;
  const found = orderId ? charges.filter((c) => c.orderId === orderId) : charges;
  res.json({ count: found.length, charges: found });
});

// Test helpers so we can break things on purpose
provider.post("/__test/slow", (req, res) => {
  slowResponsesLeft = Number(req.query.times ?? 1);
  res.json({ slowResponsesLeft });
});

provider.post("/__test/crash", (req, res) => {
  crashesLeft = Number(req.query.times ?? 1);
  crashAfterCharging = req.query.charged !== "no";
  res.json({ crashesLeft, crashAfterCharging });
});
