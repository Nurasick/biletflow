export const parseHundredths = (input: string): number | null => {
  const amount = input.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction = ""] = amount.replace(",", ".").split(".");
  const value = Number(`${whole}${fraction.padEnd(2, "0")}`);
  return Number.isSafeInteger(value) ? value : null;
};
