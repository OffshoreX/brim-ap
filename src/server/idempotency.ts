import { createHash } from "node:crypto";
import { getDb } from "./db";

// 409 so a client that reuses a key for a different request learns it, instead of getting a stranger's response back.
export class IdempotencyError extends Error {
  status = 409 as const;
}

const hashOf = (request: unknown) => createHash("sha256").update(JSON.stringify(request)).digest("hex");

// Returns the stored response text, null if the key is new, or throws if the key was used for another request.
function stored(userId: number, scope: string, key: string, hash: string): string | null {
  const row = getDb().prepare("SELECT request_hash, response FROM idempotency_keys WHERE user_id = ? AND scope = ? AND key = ?").get(userId, scope, key) as
    | { request_hash: string; response: string }
    | undefined;
  if (!row) return null;
  if (row.request_hash !== hash) throw new IdempotencyError("This Idempotency-Key was already used for a different request");
  return row.response;
}

// First writer wins: a second process saving the same key keeps the first response.
const save = (userId: number, scope: string, key: string, hash: string, response: string) =>
  getDb().prepare("INSERT OR IGNORE INTO idempotency_keys (user_id, scope, key, request_hash, response) VALUES (?,?,?,?,?)").run(userId, scope, key, hash, response);

// Sync actions (prepare, release): key lookup, the action and saving the response share one write-locked transaction,
// so two requests with the same key can never both run. Only successes are kept; a refused request can be retried.
// Without a key it is still one IMMEDIATE transaction, which is what makes read-then-write safe across processes.
export function idempotentSync<T>(userId: number, scope: string, key: string | null | undefined, request: unknown, run: () => T): T {
  return getDb()
    .transaction(() => {
      if (!key) return run();
      const hash = hashOf(request);
      const hit = stored(userId, scope, key, hash);
      if (hit !== null) return JSON.parse(hit) as T;
      const out = run();
      save(userId, scope, key, hash, JSON.stringify(out));
      return out;
    })
    .immediate();
}

// Upload is async (the model reads the file), so it cannot sit in one transaction. Same key in flight = wait for the first run;
// same key later = the stored response. ponytail: two separate processes racing on one key may both run, the content hash still
// gives one invoice and the first response saved is the one every caller gets.
const running = new Map<string, { hash: string; promise: Promise<unknown> }>();
export async function idempotentAsync<T>(userId: number, scope: string, key: string | null | undefined, request: unknown, run: () => Promise<T>): Promise<T> {
  if (!key) return run();
  const hash = hashOf(request);
  const id = JSON.stringify([userId, scope, key]);
  const hit = stored(userId, scope, key, hash);
  if (hit !== null) return JSON.parse(hit) as T;
  const inflight = running.get(id);
  if (inflight) {
    if (inflight.hash !== hash) throw new IdempotencyError("This Idempotency-Key was already used for a different request");
    return (await inflight.promise) as T;
  }
  const promise = run().then((out) => {
    save(userId, scope, key, hash, JSON.stringify(out));
    return JSON.parse(stored(userId, scope, key, hash) as string) as T;
  });
  running.set(id, { hash, promise });
  try {
    return await promise;
  } finally {
    running.delete(id);
  }
}
