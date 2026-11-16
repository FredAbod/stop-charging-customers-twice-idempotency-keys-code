const PROVIDER_URL = process.env.PROVIDER_URL ?? "http://localhost:4000";
const TIMEOUT_MS = 1000;
const MAX_ATTEMPTS = 3;

export type ChargeParams = { orderId: string; amount: number; currency: string };
export type Charge = ChargeParams & { id: string };

// "I don't know if money moved." Never charge again until you've checked.
export class PaymentUnknownError extends Error {
  name = "PaymentUnknownError";
}
// "No, and nothing was charged." Safe to try again later with a NEW key.
export class PaymentRejectedError extends Error {
  name = "PaymentRejectedError";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 409 = "this key is still being processed", 429 = "too many requests, slow down".
// In both cases nothing was saved under the key yet, so retrying with the SAME key is safe.
const isRetryableStatus = (status: number) => status === 409 || status === 429;

export async function createCharge(
  params: ChargeParams,
  getKey: () => string // where the Idempotency-Key comes from
): Promise<Charge> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const key = getKey();
    try {
      const res = await fetch(`${PROVIDER_URL}/v1/charges`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const replayed = res.headers.get("Idempotent-Replayed") === "true";
      console.log(`attempt ${attempt} key=${key.slice(0, 8)} -> ${res.status}${replayed ? " (replayed)" : ""}`);

      if (res.ok) return (await res.json()) as Charge;

      if (res.status >= 500) {
        // A 5xx is saved under the key: retrying with it only replays this same error.
        throw new PaymentUnknownError(`Provider returned ${res.status}`);
      }
      if (!isRetryableStatus(res.status)) {
        throw new PaymentRejectedError(`Provider said no: ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      if (err instanceof PaymentUnknownError || err instanceof PaymentRejectedError) throw err;
      // Timeout or network error: we don't know what happened, so retry with the same key
      console.log(`attempt ${attempt} key=${key.slice(0, 8)} -> ${(err as Error).name}`);
    }
    await sleep(200 * 2 ** attempt); // 400ms, 800ms, ...
  }
  throw new PaymentUnknownError(`No clear answer after ${MAX_ATTEMPTS} attempts`);
}

// Ask the provider: "did any charge go through for this order?"
export async function findChargeForOrder(orderId: string): Promise<Charge | undefined> {
  const res = await fetch(`${PROVIDER_URL}/v1/charges?orderId=${encodeURIComponent(orderId)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new PaymentUnknownError(`Lookup failed: ${res.status}`);
  const { charges } = (await res.json()) as { charges: Charge[] };
  return charges[0];
}
