import { describe, expect, it } from "vitest";
import { HOST_ERROR_HISTORY, recordHostError, type HostErrors } from "./hostErrors";

describe("host error history", () => {
  it("keeps the latest failure through overflow and a later recurrence", () => {
    const status: HostErrors = { errors: [], lastError: null, droppedErrors: 0 };
    for (let i = 1; i <= HOST_ERROR_HISTORY; i++) recordHostError(status, `error ${i}`);
    expect(status.errors).toHaveLength(HOST_ERROR_HISTORY);
    expect(status.lastError).toBe(`error ${HOST_ERROR_HISTORY}`);
    expect(status.droppedErrors).toBe(0);
    recordHostError(status, "fallback");
    expect(status.lastError).toBe("fallback");
    expect(status.droppedErrors).toBe(1);
    expect(status.errors[HOST_ERROR_HISTORY - 1]).toBe(`error ${HOST_ERROR_HISTORY}`);
    recordHostError(status, "fallback again");
    expect(status.lastError).toBe("fallback again");
    expect(status.droppedErrors).toBe(2);
    expect(status.errors).toHaveLength(HOST_ERROR_HISTORY);
    expect(status.errors[0]).toBe("error 1");
  });
});
