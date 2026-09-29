const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  a: 1,
  an: 1,
};

/**
 * "800", "8,000", "1.5k", "eight hundred", "two thousand five hundred", "a thousand" → a number.
 * Speech recognisers give either digits or words, so both are handled.
 */
export function parseNumber(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/-/g, " ");
  const digits = /^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|thousand)?$/.exec(t);
  if (digits) {
    const n = Number(digits[1]!.replace(/,/g, ""));
    return digits[2] ? Math.round(n * 1000) : n;
  }
  const words = t.split(/\s+/).filter((w) => w && w !== "and");
  if (!words.length) return null;
  let total = 0;
  let current = 0;
  for (const w of words) {
    if (w in UNITS) current += UNITS[w]!;
    else if (w === "hundred") current = (current || 1) * 100;
    else if (w === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
    } else return null;
  }
  return total + current;
}

export const NUMBER_PATTERN =
  "(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*(?:k|thousand)?|(?:(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and)[\\s-]*)+";
