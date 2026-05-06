import { describe, expect, it } from "vitest";
import { calculateReceiptOutputSize, type Point } from "../src/client/imageProcessing";

describe("receipt crop output sizing", () => {
  it("keeps the selected rectangle size without forcing A4-like dimensions", () => {
    const corners: Point[] = [
      { x: 100, y: 150 },
      { x: 3100, y: 150 },
      { x: 3100, y: 4150 },
      { x: 100, y: 4150 }
    ];

    expect(calculateReceiptOutputSize(corners)).toEqual({ width: 3000, height: 4000 });
  });

  it("uses the selected quadrilateral proportions for perspective crops", () => {
    const corners: Point[] = [
      { x: 120, y: 80 },
      { x: 1920, y: 140 },
      { x: 1800, y: 3140 },
      { x: 80, y: 3020 }
    ];

    const size = calculateReceiptOutputSize(corners);

    expect(size.width).toBeGreaterThan(1700);
    expect(size.width).toBeLessThan(1900);
    expect(size.height).toBeGreaterThan(2950);
    expect(size.height).toBeLessThan(3100);
  });
});
