export interface ParsedMoney {
  raw: string;
  cents: number;
  normalized: string;
}

const currencyTokens = /(?:EUR|€|USD|\$|GBP|£|LVL|Ls)/gi;

export function parseMoneyToCents(input: unknown): ParsedMoney | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    return {
      raw: String(input),
      cents: Math.round(input * 100),
      normalized: input.toFixed(2)
    };
  }

  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  let text = raw.replace(currencyTokens, "").replace(/\u00a0/g, " ").trim();
  const negative = /^-/.test(text) || /\(-?/.test(text);
  text = text.replace(/[()]/g, "").replace(/^-/, "").trim();
  text = text.replace(/\s+/g, "");

  if (!/[0-9]/.test(text)) return null;
  if (!/^[0-9.,'`]+$/.test(text)) return null;

  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  const decimalIndex = Math.max(comma, dot);
  let whole = text;
  let fraction = "";

  if (decimalIndex >= 0) {
    const possibleFraction = text.slice(decimalIndex + 1);
    const before = text.slice(0, decimalIndex);
    const separator = text[decimalIndex];
    const hasBothSeparators = comma >= 0 && dot >= 0;

    if (possibleFraction.length === 1 || possibleFraction.length === 2 || hasBothSeparators) {
      whole = before;
      fraction = possibleFraction;
    } else if ((separator === "," || separator === ".") && possibleFraction.length === 3 && before.length <= 3 && !hasBothSeparators) {
      whole = text;
      fraction = "";
    } else {
      return null;
    }
  }

  whole = whole.replace(/[.,'`]/g, "");
  fraction = fraction.replace(/[.,'`]/g, "");

  if (!/^\d+$/.test(whole || "0")) return null;
  if (fraction && !/^\d{1,2}$/.test(fraction)) return null;

  const paddedFraction = (fraction + "00").slice(0, 2);
  const euros = Number.parseInt(whole || "0", 10);
  const cents = Number.parseInt(paddedFraction, 10);
  if (!Number.isSafeInteger(euros) || !Number.isSafeInteger(cents)) return null;

  const value = euros * 100 + cents;
  return {
    raw,
    cents: negative ? -value : value,
    normalized: `${negative ? "-" : ""}${euros}.${paddedFraction}`
  };
}

export function moneyCentsFromValue(value: { cents?: number | null; raw?: string | null } | null | undefined): number | null {
  if (!value) return null;
  if (typeof value.cents === "number" && Number.isFinite(value.cents)) return Math.round(value.cents);
  const parsed = parseMoneyToCents(value.raw);
  return parsed?.cents ?? null;
}

export function formatCents(cents: number | null | undefined, currency = "EUR"): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("lv-LV", {
    style: "currency",
    currency,
    minimumFractionDigits: 2
  }).format(cents / 100);
}

export function centsEqual(a: number | null, b: number | null, toleranceCents = 1): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= toleranceCents;
}
