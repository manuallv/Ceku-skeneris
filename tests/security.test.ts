import { describe, expect, it } from "vitest";
import { LocalFileStorage, sanitizeSegment } from "../src/server/storage/localStorage";

describe("file safety", () => {
  it("rejects path traversal segments", () => {
    expect(() => sanitizeSegment("..")).toThrow();
    expect(() => sanitizeSegment("../secret")).not.toThrow();
    expect(sanitizeSegment("../secret")).not.toContain("/");
  });

  it("keeps storage keys inside the configured root", () => {
    const storage = new LocalFileStorage("/tmp/ceku-storage-test");
    expect(() => storage.absolutePath("../../etc/passwd")).toThrow();
    expect(storage.absolutePath("receipt/file.png")).toContain("/tmp/ceku-storage-test");
  });
});
