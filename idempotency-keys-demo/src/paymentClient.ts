const PROVIDER_URL = process.env.PROVIDER_URL ?? "http://localhost:4000";
const TIMEOUT_MS = 1000;
const MAX_ATTEMPTS = 3;

export type ChargeParams = { orderId: string; amount: number; currency: string };
export type Charge = ChargeParams & { id: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Errors worth retrying: timeouts, network drops, "busy", "slow down", server errors
const isRetryableStatus = (status: number) => status === 409 || status === 429 || status >= 500;

export async function createCharge(
  params: ChargeParams,
  getKey: () => string // where the Idempotency-Key comes from
): Promise<Charge> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const key = getKey();
    try {
      const res = await fetch(`${PROVIDER_URL}/v1/charges`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.ok) {
        const replayed = res.headers.get("Idempotent-Replayed") === "true";
        console.log(`attempt ${attempt} key=${key.slice(0, 8)} -> ${res.status}${replayed ? " (replayed)" : ""}`);
        return (await res.json()) as Charge;
      }
      if (!isRetryableStatus(res.status)) {
        throw new Error(`Provider said no: ${res.status} ${await res.text()}`);
      }
      lastError = new Error(`Provider returned ${res.status}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Provider said no")) throw err;
      lastError = err;
      console.log(`attempt ${attempt} key=${key.slice(0, 8)} -> ${(err as Error).name}`);
    }
    await sleep(200 * 2 ** attempt); // 400ms, 800ms, ...
  }
  throw lastError;
}
