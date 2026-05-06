import { describe, expect, it } from "vitest";
import { centsEqual, formatCents, parseMoneyToCents } from "../src/shared/money";

describe("money parsing", () => {
  it("normalizes Latvian comma decimals to cents", () => {
    expect(parseMoneyToCents("1 234,56 €")?.cents).toBe(123456);
    expect(parseMoneyToCents("0,05")?.cents).toBe(5);
  });

  it("normalizes dot decimals and currency prefixes", () => {
    expect(parseMoneyToCents("EUR 12.30")?.cents).toBe(1230);
    expect(parseMoneyToCents("€12.3")?.cents).toBe(1230);
  });

  it("does not accept malformed decimals", () => {
    expect(parseMoneyToCents("12,3456")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
  });

  it("compares cents with tolerance and formats values", () => {
    expect(centsEqual(100, 101, 1)).toBe(true);
    expect(centsEqual(100, 102, 1)).toBe(false);
    expect(formatCents(1234, "EUR")).toContain("12,34");
  });
});
