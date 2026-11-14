import express from "express";
import { randomUUID } from "node:crypto";
import { createCharge } from "./paymentClient.js";
import { createOrder, findOrder, markPaid } from "./orders.js";

export const app = express();
app.use(express.json());

app.post("/orders", (req, res) => {
  const { amount, currency } = req.body as { amount: number; currency: string };
  if (!Number.isInteger(amount) || amount <= 0 || typeof currency !== "string") {
    res.status(400).json({ error: "amount (integer, minor units) and currency are required" });
    return;
  }
  res.status(201).json(createOrder(amount, currency));
});

// ❌ The bug: a brand-new key on every attempt
app.post("/orders/:id/pay-naive", async (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const charge = await createCharge(
    { orderId: order.id, amount: order.amount, currency: order.currency },
    () => randomUUID()
  );
  markPaid(order, charge.id);
  res.json(order);
});

// ✅ The fix: one key per order, saved before the first attempt, reused every time
app.post("/orders/:id/pay", async (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (order.status === "paid") {
    res.json(order); // already paid, nothing to do
    return;
  }
  const charge = await createCharge(
    { orderId: order.id, amount: order.amount, currency: order.currency },
    () => order.paymentKey
  );
  markPaid(order, charge.id);
  res.json(order);
});

app.get("/orders/:id", (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(order);
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(502).json({ error: "Payment status unknown. Do not charge again; check with the provider." });
});
