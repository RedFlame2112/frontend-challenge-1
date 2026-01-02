export const BILLING_CODE_TYPE_VERSION = "2024";

// Normalize place-of-service labels to standard service codes.
const SERVICE_CODE_MAP: Record<string, string> = {
  "inpatient hospital": "21",
  "outpatient hospital": "22",
  "emergency room - hospital": "23",
  "ambulatory surgical center": "24",
  "urgent care": "20",
  "office": "11",
};

export function getBillingClass(claimType: string): "professional" | "institutional" {
  return claimType?.trim().toLowerCase() === "professional" ? "professional" : "institutional";
}

export function getServiceCode(placeOfService: string): string {
  const normalized = placeOfService?.trim().toLowerCase();
  return SERVICE_CODE_MAP[normalized] ?? "99";
}

export function getBillingCodeType(procedureCode: string): "CPT" | "HCPCS" {
  return /[a-zA-Z]/.test(procedureCode) ? "HCPCS" : "CPT";
}

export function roundCurrency(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

export function slugify(value: string): string {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return "unknown";
  }

  const slug = trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "unknown";
}
