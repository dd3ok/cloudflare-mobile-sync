import { describe, expect, it } from "vitest";
import { jsonPayloadSchema, LIMITS, pullQuerySchema, pushRequestSchema } from "./index";

describe("API contract", () => {
  it("accepts a bounded put mutation", () => {
    const parsed = pushRequestSchema.parse({
      mutations: [
        {
          mutationId: "mutation_1",
          collection: "notes",
          recordId: "note-1",
          baseRevision: 0,
          operation: "put",
          payload: { title: "offline first" },
        },
      ],
    });

    expect(parsed.mutations).toHaveLength(1);
  });

  it("rejects client-controlled user IDs and unknown fields", () => {
    const parsed = pushRequestSchema.safeParse({
      userId: "another-user",
      mutations: [
        {
          mutationId: "mutation_1",
          collection: "notes",
          recordId: "note-1",
          baseRevision: 0,
          operation: "delete",
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects deeply nested JSON", () => {
    let value: unknown = "leaf";
    for (let index = 0; index <= LIMITS.jsonDepth; index += 1) value = [value];

    expect(jsonPayloadSchema.safeParse(value).success).toBe(false);
  });

  it("rejects adversarial JSON depth without overflowing the call stack", () => {
    let value: unknown = "leaf";
    for (let index = 0; index < 5_000; index += 1) value = [value];

    expect(() => jsonPayloadSchema.safeParse(value)).not.toThrow();
    expect(jsonPayloadSchema.safeParse(value).success).toBe(false);
  });

  it("bounds pull pages", () => {
    expect(pullQuerySchema.parse({})).toEqual({ cursor: 0, limit: LIMITS.pullDefault });
    expect(pullQuerySchema.safeParse({ cursor: 0, limit: LIMITS.pullMaximum + 1 }).success).toBe(
      false,
    );
  });

  it("preserves the 25-mutation client contract", () => {
    const mutations = Array.from({ length: 26 }, (_, index) => ({
      mutationId: `mutation_${index}`,
      collection: "notes",
      recordId: `note-${index}`,
      baseRevision: 0,
      operation: "delete" as const,
    }));

    expect(pushRequestSchema.safeParse({ mutations: mutations.slice(0, 25) }).success).toBe(true);
    expect(pushRequestSchema.safeParse({ mutations }).success).toBe(false);
  });
});
