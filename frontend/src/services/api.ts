import type { ClaimInput, MrfCustomerRecord, MrfFileRecord } from "~/stores/appStore";

// Allow local overrides for the API base URL.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

export type CreateMrfResponse = {
  generated: MrfFileRecord[];
};

export type MrfListResponse = {
  customers: MrfCustomerRecord[];
};

export async function createMrfFiles(claims: ClaimInput[]): Promise<CreateMrfResponse> {
  const response = await fetch(`${API_BASE_URL}/api/mrf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claims }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? "Failed to generate MRF files.");
  }

  return response.json();
}

export async function fetchMrfList(customerId?: string): Promise<MrfListResponse> {
  const url = customerId
    ? `${API_BASE_URL}/api/mrf/${encodeURIComponent(customerId)}`
    : `${API_BASE_URL}/api/mrf`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch MRF files.");
  }

  return response.json();
}

export function getMrfDownloadUrl(customerId: string, fileName: string): string {
  return `${API_BASE_URL}/api/mrf/${encodeURIComponent(customerId)}/files/${encodeURIComponent(fileName)}`;
}
