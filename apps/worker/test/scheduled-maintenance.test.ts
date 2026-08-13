import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { runScheduledMaintenance } from "../src/scheduled-maintenance";

describe("scheduled security-data maintenance", () => {
  it("removes expired auth handoffs and account-deletion receipts without traffic", async () => {
    const now = Date.now();
    const handoffId = "a".repeat(64);
    const operationHash = "b".repeat(64);
    const subjectHash = "c".repeat(64);
    await env.DB.prepare(
      `INSERT INTO mobile_auth_handoff
       (id, audience, code_challenge, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(handoffId, "test", "d".repeat(43), now - 2_000, now - 1_000)
      .run();
    await env.DB.prepare(
      `INSERT INTO account_deletion_receipt
       (operation_hash, subject_hash, result_json, completed_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(operationHash, subjectHash, "{}", new Date(now - 2_000).toISOString(), now - 1_000)
      .run();

    await runScheduledMaintenance(env, now);

    expect(
      await env.DB.prepare(`SELECT id FROM mobile_auth_handoff WHERE id = ?`)
        .bind(handoffId)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        `SELECT operation_hash FROM account_deletion_receipt WHERE operation_hash = ?`,
      )
        .bind(operationHash)
        .first(),
    ).toBeNull();
  });
});
