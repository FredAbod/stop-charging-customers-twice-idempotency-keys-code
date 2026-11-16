import { randomUUID } from "node:crypto";

export type Order = {
  id: string;
  amount: number; // minor units, e.g. kobo
  currency: string;
  status: "pending" | "paid" | "payment_unknown";
  paymentKey: string; // the Idempotency-Key for paying THIS order
  chargeId?: string;
};

// In-memory "database". In real life this is a table with a unique paymentKey column.
const orders = new Map<string, Order>();

export function createOrder(amount: number, currency: string): Order {
  const order: Order = {
    id: `ord_${randomUUID().slice(0, 8)}`,
    amount,
    currency,
    status: "pending",
    paymentKey: randomUUID(), // created and saved BEFORE any payment attempt
  };
  orders.set(order.id, order);
  return order;
}

export const findOrder = (id: string) => orders.get(id);

export function markPaid(order: Order, chargeId: string) {
  order.status = "paid";
  order.chargeId = chargeId;
}

export function markUnknown(order: Order) {
  order.status = "payment_unknown"; // money MAY have moved. Check before charging again.
}

// Only call this once you KNOW nothing was charged with the old key
export function resetForNewAttempt(order: Order) {
  order.status = "pending";
  order.paymentKey = randomUUID();
}
