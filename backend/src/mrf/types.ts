// Types mirror the subset of the TiC MRF schema used by this demo.
export type ClaimInput = {
  claimId: string;
  groupId: string;
  groupName: string;
  planName?: string;
  planId?: string;
  placeOfService: string;
  claimType: string;
  procedureCode: string;
  providerId: string;
  providerName: string;
  billed: number;
  allowed: number;
  paid: number;
};

export type MrfProvider = {
  billed_charge: number;
  npi: number[];
};

export type MrfPayment = {
  allowed_amount: number;
  providers: MrfProvider[];
  billing_code_modifier?: string[];
};

export type MrfAllowedAmount = {
  tin: {
    type: "ein" | "npi";
    value: string;
  };
  billing_class: "professional" | "institutional";
  service_code?: string[];
  payments: MrfPayment[];
};

export type MrfOutOfNetwork = {
  name: string;
  billing_code_type: "CPT" | "HCPCS" | "ICD" | "MS-DRG" | "R-DRG" | "S-DRG" | "APS-DRG" | "AP-DRG" | "APR-DRG" | "APC" | "NDC" | "HIPPS" | "LOCAL" | "EAPG" | "CDT" | "RC";
  billing_code_type_version: string;
  billing_code: string;
  description: string;
  allowed_amounts: MrfAllowedAmount[];
};

export type MrfFile = {
  reporting_entity_name: string;
  reporting_entity_type: string;
  plan_name?: string;
  issuer_name?: string;
  plan_sponsor_name?: string;
  plan_id_type?: "ein" | "hios";
  plan_id?: string;
  plan_market_type?: "group" | "individual";
  last_updated_on: string;
  version: string;
  out_of_network: MrfOutOfNetwork[];
};

export type GeneratedMrf = {
  customerId: string;
  customerKey: string;
  customerName: string;
  fileName: string;
  claimCount: number;
  data: MrfFile;
};

export type MrfFileRecord = {
  customerId: string;
  customerKey: string;
  customerName: string;
  fileName: string;
  createdAt: string;
  claimCount: number;
  size: number;
};

export type MrfCustomerRecord = {
  id: string;
  key: string;
  name: string;
  files: MrfFileRecord[];
};

export type MrfIndex = {
  customers: Record<string, MrfCustomerRecord>;
};
