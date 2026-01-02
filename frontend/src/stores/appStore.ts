import { makeAutoObservable, runInAction } from "mobx";
import Papa from "papaparse";
import { z } from "zod";
import { createMrfFiles, fetchMrfList } from "~/services/api";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const providerIdRegex = /^\d{10}$/;
const claimTypeSet = new Set(["professional", "institutional"]);
const SERVICE_CODE_MAP: Record<string, string> = {
  "inpatient hospital": "21",
  "outpatient hospital": "22",
  "emergency room - hospital": "23",
  "ambulatory surgical center": "24",
  "urgent care": "20",
  "office": "11",
};

type BillingClass = "professional" | "institutional";

export type GroupingMethod = "mrf" | "providerProcedure" | "provider" | "procedure" | "planProcedure";

type GroupKeyField = "customerId" | "providerId" | "procedureCode" | "billingClass" | "serviceCode" | "planId";

type GroupingDefinition = {
  value: GroupingMethod;
  label: string;
  description: string;
  keyFields: GroupKeyField[];
};

// Grouping options drive both UI labels and aggregation keys.
const GROUPING_DEFINITIONS: GroupingDefinition[] = [
  {
    value: "mrf",
    label: "MRF standard",
    description: "Groups by provider, procedure, place of service (service code), and billing class per customer.",
    keyFields: ["customerId", "providerId", "procedureCode", "billingClass", "serviceCode"],
  },
  {
    value: "providerProcedure",
    label: "Provider + procedure",
    description: "Groups by provider, procedure, and billing class per customer.",
    keyFields: ["customerId", "providerId", "procedureCode", "billingClass"],
  },
  {
    value: "provider",
    label: "Provider",
    description: "Groups by provider and billing class per customer.",
    keyFields: ["customerId", "providerId", "billingClass"],
  },
  {
    value: "procedure",
    label: "Procedure",
    description: "Groups by procedure and billing class per customer.",
    keyFields: ["customerId", "procedureCode", "billingClass"],
  },
  {
    value: "planProcedure",
    label: "Plan + procedure",
    description: "Groups by plan, procedure, and billing class per customer.",
    keyFields: ["customerId", "planId", "procedureCode", "billingClass"],
  },
];

const GROUPING_CONFIGS = GROUPING_DEFINITIONS.reduce(
  (acc, definition) => {
    acc[definition.value] = definition;
    return acc;
  },
  {} as Record<GroupingMethod, GroupingDefinition>
);

type GroupKeyParts = {
  customerId: string;
  providerId: string;
  procedureCode: string;
  billingClass: BillingClass;
  serviceCode?: string;
  planId: string;
};

const claimSchema = z
  .object({
    claimId: z.string().min(1),
    subscriberId: z.string().min(1),
    memberSequence: z.number().int().nonnegative().finite(),
    claimStatus: z.string().min(1),
    billed: z.number().nonnegative().finite(),
    allowed: z.number().nonnegative().finite(),
    paid: z.number().nonnegative().finite(),
    paymentStatusDate: z.string().regex(dateRegex),
    serviceDate: z.string().regex(dateRegex),
    receivedDate: z.string().regex(dateRegex),
    entryDate: z.string().regex(dateRegex),
    processedDate: z.string().regex(dateRegex),
    paidDate: z.string().regex(dateRegex),
    paymentStatus: z.string().min(1),
    groupName: z.string(),
    groupId: z.string(),
    divisionName: z.string().min(1),
    divisionId: z.string().min(1),
    planName: z.string().min(1),
    planId: z.string().min(1),
    placeOfService: z.string().min(1),
    claimType: z
      .string()
      .min(1)
      .refine((value) => claimTypeSet.has(value.trim().toLowerCase()), {
        message: "Claim Type must be Professional or Institutional.",
      }),
    procedureCode: z.string().min(1),
    memberGender: z.string().min(1),
    providerId: z.string().regex(providerIdRegex, "Provider ID must be a 10-digit NPI."),
    providerName: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    if (!value.groupId && !value.groupName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groupId"],
        message: "Group ID or Group Name is required.",
      });
    }
  });

const NUMBER_FIELDS = new Set<keyof ClaimRow>(["memberSequence", "billed", "allowed", "paid"]);

export type ClaimRow = z.infer<typeof claimSchema> & {
  id: string;
  rowIndex: number;
  isValid: boolean;
};

export type ClaimInput = Omit<ClaimRow, "id" | "rowIndex" | "isValid">;

export type PricingGroup = {
  id: string;
  customerId: string;
  customerName: string;
  procedureCode: string;
  providerId: string;
  providerName: string;
  planName: string;
  planId: string;
  placeOfService: string;
  claimType: string;
  billingClass: string;
  serviceCode?: string;
  searchText: string;
  claimCount: number;
  validClaimCount: number;
  eligibleClaimCount: number;
  invalidClaimCount: number;
  deniedClaimCount: number;
  averageAllowed: number;
  averageBilled: number;
  averagePaid: number;
  approved: boolean;
  isEligible: boolean;
};

export type ValidationIssue = {
  rowIndex: number;
  field: string;
  message: string;
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

type RawRow = Record<string, string>;

const DEMO_CREDENTIALS = {
  username: "demo",
  password: "demo",
};

type GroupAccumulator = {
  id: string;
  customerId: string;
  customerName: string;
  providerIds: Set<string>;
  providerNames: Set<string>;
  procedureCodes: Set<string>;
  placeOfServices: Set<string>;
  billingClasses: Set<string>;
  claimTypes: Set<string>;
  serviceCodes: Set<string>;
  planIds: Set<string>;
  planNames: Set<string>;
  claimCount: number;
  validClaimCount: number;
  eligibleClaimCount: number;
  invalidClaimCount: number;
  deniedClaimCount: number;
  sumAllowed: number;
  sumBilled: number;
  sumPaid: number;
};

const DENIED_STATUSES = new Set(["denied", "reject", "rejected"]);

function parseNumber(value: string | undefined): number {
  const normalized = value?.replace(/,/g, "").trim();
  const parsed = Number.parseFloat(normalized ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function roundCurrency(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function getBillingClass(claimType: string): BillingClass {
  return claimType?.trim().toLowerCase() === "professional" ? "professional" : "institutional";
}

function getServiceCode(placeOfService: string): string {
  const normalized = placeOfService?.trim().toLowerCase();
  return SERVICE_CODE_MAP[normalized] ?? "99";
}

function getCustomerId(claim: ClaimRow): string {
  return claim.groupId?.trim() || claim.groupName?.trim() || "unknown";
}

export function isDeniedStatus(status: string): boolean {
  return DENIED_STATUSES.has(status?.trim().toLowerCase());
}

function isEligibleClaim(claim: ClaimRow): boolean {
  return claim.isValid && !isDeniedStatus(claim.claimStatus);
}

function normalizeKeyPart(value: string | undefined, fallback = "unknown"): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function normalizeDisplayValue(value: string | undefined, fallback = "Unknown"): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function formatSetValue(values: Set<string>, emptyLabel = "-"): string {
  if (values.size === 0) {
    return emptyLabel;
  }
  if (values.size === 1) {
    return Array.from(values)[0];
  }
  return `Multiple (${values.size})`;
}

function compareSortValues(left: string[], right: string[]): number {
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const leftValue = (left[index] ?? "").toLowerCase();
    const rightValue = (right[index] ?? "").toLowerCase();
    const comparison = leftValue.localeCompare(rightValue);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

const GROUP_SORT_ACCESSORS: Record<GroupKeyField, (group: PricingGroup) => string[]> = {
  customerId: (group) => [group.customerName, group.customerId],
  providerId: (group) => [group.providerName, group.providerId],
  procedureCode: (group) => [group.procedureCode],
  billingClass: (group) => [group.billingClass],
  serviceCode: (group) => [group.serviceCode ?? ""],
  planId: (group) => [group.planName, group.planId],
};

function buildGroupKey(groupingMethod: GroupingMethod, parts: GroupKeyParts): string {
  const config = GROUPING_CONFIGS[groupingMethod];
  return config.keyFields
    .map((field) => {
      if (field === "serviceCode") {
        return normalizeKeyPart(parts.serviceCode, "none");
      }
      return normalizeKeyPart(String(parts[field]));
    })
    .join("|");
}

function getGroupKey(claim: ClaimRow, groupingMethod: GroupingMethod): string {
  const billingClass = getBillingClass(claim.claimType);
  const serviceCode = billingClass === "professional" ? getServiceCode(claim.placeOfService) : undefined;

  return buildGroupKey(groupingMethod, {
    customerId: getCustomerId(claim),
    providerId: claim.providerId,
    procedureCode: claim.procedureCode,
    billingClass,
    serviceCode,
    planId: claim.planId,
  });
}

function buildSearchText(group: GroupAccumulator): string {
  const tokens = new Set<string>();
  const addToken = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) {
      tokens.add(trimmed.toLowerCase());
    }
  };
  const addSet = (values: Set<string>) => {
    for (const value of values) {
      addToken(value);
    }
  };

  addToken(group.customerId);
  addToken(group.customerName);
  addSet(group.providerIds);
  addSet(group.providerNames);
  addSet(group.procedureCodes);
  addSet(group.placeOfServices);
  addSet(group.billingClasses);
  addSet(group.claimTypes);
  addSet(group.planIds);
  addSet(group.planNames);
  addSet(group.serviceCodes);

  return Array.from(tokens).join(" ");
}

function buildGroupClaimMap(claims: ClaimRow[], groupingMethod: GroupingMethod): Map<string, ClaimRow[]> {
  const groups = new Map<string, ClaimRow[]>();

  for (const claim of claims) {
    const groupKey = getGroupKey(claim, groupingMethod);
    const existing = groups.get(groupKey);
    if (existing) {
      existing.push(claim);
    } else {
      groups.set(groupKey, [claim]);
    }
  }

  return groups;
}

function buildGroupAccumulators(claims: ClaimRow[], groupingMethod: GroupingMethod): Map<string, GroupAccumulator> {
  const groups = new Map<string, GroupAccumulator>();

  for (const claim of claims) {
    const customerId = getCustomerId(claim);
    const customerName = claim.groupName || customerId;
    const billingClass = getBillingClass(claim.claimType);
    const serviceCode = billingClass === "professional" ? getServiceCode(claim.placeOfService) : undefined;
    const groupKey = buildGroupKey(groupingMethod, {
      customerId,
      providerId: claim.providerId,
      procedureCode: claim.procedureCode,
      billingClass,
      serviceCode,
      planId: claim.planId,
    });

    const existing = groups.get(groupKey) ?? {
      id: groupKey,
      customerId,
      customerName,
      providerIds: new Set<string>(),
      providerNames: new Set<string>(),
      procedureCodes: new Set<string>(),
      placeOfServices: new Set<string>(),
      billingClasses: new Set<string>(),
      claimTypes: new Set<string>(),
      serviceCodes: new Set<string>(),
      planIds: new Set<string>(),
      planNames: new Set<string>(),
      claimCount: 0,
      validClaimCount: 0,
      eligibleClaimCount: 0,
      invalidClaimCount: 0,
      deniedClaimCount: 0,
      sumAllowed: 0,
      sumBilled: 0,
      sumPaid: 0,
    };

    existing.claimCount += 1;
    existing.providerIds.add(normalizeDisplayValue(claim.providerId));
    existing.providerNames.add(normalizeDisplayValue(claim.providerName));
    existing.procedureCodes.add(normalizeDisplayValue(claim.procedureCode));
    existing.placeOfServices.add(normalizeDisplayValue(claim.placeOfService));
    existing.billingClasses.add(billingClass);
    existing.claimTypes.add(normalizeDisplayValue(claim.claimType));
    existing.planIds.add(normalizeDisplayValue(claim.planId));
    existing.planNames.add(normalizeDisplayValue(claim.planName));

    if (serviceCode) {
      existing.serviceCodes.add(serviceCode);
    }

    const denied = isDeniedStatus(claim.claimStatus);

    if (claim.isValid) {
      existing.validClaimCount += 1;
      if (!denied) {
        existing.eligibleClaimCount += 1;
        existing.sumAllowed += Number(claim.allowed) || 0;
        existing.sumBilled += Number(claim.billed) || 0;
        existing.sumPaid += Number(claim.paid) || 0;
      }
    } else {
      existing.invalidClaimCount += 1;
    }

    if (denied) {
      existing.deniedClaimCount += 1;
    }

    groups.set(groupKey, existing);
  }

  return groups;
}

function normalizeRow(row: RawRow, rowIndex: number): ClaimRow {
  const claimId = (row["Claim ID"] ?? "").trim();

  return {
    id: claimId || `row-${rowIndex + 1}`,
    rowIndex: rowIndex + 1,
    isValid: true,
    claimId,
    subscriberId: (row["Subscriber ID"] ?? "").trim(),
    memberSequence: parseNumber(row["Member Sequence"]),
    claimStatus: (row["Claim Status"] ?? "").trim(),
    billed: parseNumber(row["Billed"]),
    allowed: parseNumber(row["Allowed"]),
    paid: parseNumber(row["Paid"]),
    paymentStatusDate: (row["Payment Status Date"] ?? "").trim(),
    serviceDate: (row["Service Date"] ?? "").trim(),
    receivedDate: (row["Received Date"] ?? "").trim(),
    entryDate: (row["Entry Date"] ?? "").trim(),
    processedDate: (row["Processed Date"] ?? "").trim(),
    paidDate: (row["Paid Date"] ?? "").trim(),
    paymentStatus: (row["Payment Status"] ?? "").trim(),
    groupName: (row["Group Name"] ?? "").trim(),
    groupId: (row["Group ID"] ?? "").trim(),
    divisionName: (row["Division Name"] ?? "").trim(),
    divisionId: (row["Division ID"] ?? "").trim(),
    planName: (row["Plan"] ?? "").trim(),
    planId: (row["Plan ID"] ?? "").trim(),
    placeOfService: (row["Place of Service"] ?? "").trim(),
    claimType: (row["Claim Type"] ?? "").trim(),
    procedureCode: (row["Procedure Code"] ?? "").trim(),
    memberGender: (row["Member Gender"] ?? "").trim(),
    providerId: (row["Provider ID"] ?? "").trim(),
    providerName: (row["Provider Name"] ?? "").trim(),
  };
}

function toClaimInput(claim: ClaimRow): ClaimInput {
  const { id, rowIndex, isValid, ...rest } = claim;
  return rest;
}

function validateClaim(claim: ClaimRow): ValidationIssue[] {
  const result = claimSchema.safeParse(toClaimInput(claim));
  if (result.success) {
    return [];
  }

  return result.error.issues.map((issue) => ({
    rowIndex: claim.rowIndex,
    field: issue.path.join(".") || "unknown",
    message: issue.message,
  }));
}

class AppStore {
  fileName: string | null = null;
  claims: ClaimRow[] = [];
  rowIssues: Record<string, ValidationIssue[]> = {};
  parseError: string | null = null;
  isParsing = false;
  groupApprovals: Record<string, boolean> = {};
  approvedClaims: Record<string, boolean> = {};
  groupingMethod: GroupingMethod = "mrf";

  isSubmitting = false;
  submitError: string | null = null;
  submitResult: MrfFileRecord[] = [];

  mrfCustomers: MrfCustomerRecord[] = [];
  mrfLoading = false;
  mrfError: string | null = null;

  isAuthenticated = false;
  authError: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  get validCount(): number {
    return this.claims.filter((claim) => claim.isValid).length;
  }

  get eligibleCount(): number {
    return this.claims.filter((claim) => isEligibleClaim(claim)).length;
  }

  get invalidClaims(): ClaimRow[] {
    return this.claims.filter((claim) => !claim.isValid);
  }

  get deniedClaims(): ClaimRow[] {
    return this.claims.filter((claim) => isDeniedStatus(claim.claimStatus));
  }

  get attentionClaims(): ClaimRow[] {
    return this.claims.filter((claim) => !claim.isValid || isDeniedStatus(claim.claimStatus));
  }

  get invalidCount(): number {
    return this.invalidClaims.length;
  }

  get deniedCount(): number {
    return this.deniedClaims.length;
  }

  get attentionCount(): number {
    return this.attentionClaims.length;
  }

  get groupingOptions(): { value: GroupingMethod; label: string }[] {
    return GROUPING_DEFINITIONS.map(({ value, label }) => ({ value, label }));
  }

  get groupingDescription(): string {
    return GROUPING_CONFIGS[this.groupingMethod].description;
  }

  get groupingLabel(): string {
    return GROUPING_CONFIGS[this.groupingMethod].label;
  }

  get groupingKeyFields(): GroupKeyField[] {
    return GROUPING_CONFIGS[this.groupingMethod].keyFields;
  }

  get groupingUsesPlan(): boolean {
    return this.groupingKeyFields.includes("planId");
  }

  get groupingUsesProvider(): boolean {
    return this.groupingKeyFields.includes("providerId");
  }

  get groupingUsesProcedure(): boolean {
    return this.groupingKeyFields.includes("procedureCode");
  }

  get groupingUsesServiceCode(): boolean {
    return this.groupingKeyFields.includes("serviceCode");
  }

  get groupSummaries(): PricingGroup[] {
    const groups = buildGroupAccumulators(this.claims, this.groupingMethod);
    const summaries: PricingGroup[] = [];

    for (const group of groups.values()) {
      const averageAllowed =
        group.eligibleClaimCount > 0
          ? roundCurrency(group.sumAllowed / group.eligibleClaimCount)
          : Number.NaN;
      const averageBilled =
        group.eligibleClaimCount > 0
          ? roundCurrency(group.sumBilled / group.eligibleClaimCount)
          : Number.NaN;
      const averagePaid =
        group.eligibleClaimCount > 0
          ? roundCurrency(group.sumPaid / group.eligibleClaimCount)
          : Number.NaN;

      const procedureCode = formatSetValue(group.procedureCodes);
      const providerId = formatSetValue(group.providerIds);
      const providerName = formatSetValue(group.providerNames);
      const placeOfService = formatSetValue(group.placeOfServices);
      const billingClass = formatSetValue(group.billingClasses);
      const claimType = formatSetValue(group.claimTypes);
      const planId = formatSetValue(group.planIds);
      const planName = formatSetValue(group.planNames);
      const serviceCode = group.serviceCodes.size > 0 ? formatSetValue(group.serviceCodes) : undefined;

      summaries.push({
        id: group.id,
        customerId: group.customerId,
        customerName: group.customerName,
        procedureCode,
        providerId,
        providerName,
        planName,
        planId,
        placeOfService,
        claimType,
        billingClass,
        serviceCode,
        searchText: buildSearchText(group),
        claimCount: group.claimCount,
        validClaimCount: group.validClaimCount,
        eligibleClaimCount: group.eligibleClaimCount,
        invalidClaimCount: group.invalidClaimCount,
        deniedClaimCount: group.deniedClaimCount,
        averageAllowed,
        averageBilled,
        averagePaid,
        approved: Boolean(this.groupApprovals[group.id]),
        isEligible:
          group.eligibleClaimCount > 0 && group.invalidClaimCount === 0 && group.deniedClaimCount === 0,
      });
    }

    const sortFields = GROUPING_CONFIGS[this.groupingMethod].keyFields;

    return summaries.sort((left, right) => {
      for (const field of sortFields) {
        const accessor = GROUP_SORT_ACCESSORS[field];
        const comparison = compareSortValues(accessor(left), accessor(right));
        if (comparison !== 0) {
          return comparison;
        }
      }
      return left.id.localeCompare(right.id);
    });
  }

  get groupCount(): number {
    return this.groupSummaries.length;
  }

  get approvedGroupCount(): number {
    return this.groupSummaries.filter((group) => group.approved).length;
  }

  get approvedClaimCount(): number {
    return this.claims.filter(
      (claim) =>
        isEligibleClaim(claim) && Boolean(this.groupApprovals[getGroupKey(claim, this.groupingMethod)])
    ).length;
  }

  get hasClaims(): boolean {
    return this.claims.length > 0;
  }

  get validationIssues(): ValidationIssue[] {
    return Object.values(this.rowIssues).flat();
  }

  login(username: string, password: string): void {
    if (username === DEMO_CREDENTIALS.username && password === DEMO_CREDENTIALS.password) {
      this.isAuthenticated = true;
      this.authError = null;
    } else {
      this.authError = "Invalid credentials.";
    }
  }

  logout(): void {
    this.isAuthenticated = false;
    this.fileName = null;
    this.claims = [];
    this.rowIssues = {};
    this.submitResult = [];
    this.submitError = null;
    this.groupApprovals = {};
    this.approvedClaims = {};
  }

  setGroupingMethod(method: GroupingMethod): void {
    if (method === this.groupingMethod) {
      return;
    }
    this.groupingMethod = method;
    this.syncGroupApprovals();
  }

  parseCsv(file: File): void {
    this.isParsing = true;
    this.parseError = null;
    this.rowIssues = {};
    this.claims = [];
    this.submitError = null;
    this.submitResult = [];
    this.groupApprovals = {};
    this.approvedClaims = {};

    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const nextClaims: ClaimRow[] = [];
        const nextRowIssues: Record<string, ValidationIssue[]> = {};

        results.data.forEach((row, index) => {
          const normalized = normalizeRow(row, index);
          const issues = validateClaim(normalized);
          normalized.isValid = issues.length === 0;
          if (issues.length > 0) {
            nextRowIssues[normalized.id] = issues;
          }
          nextClaims.push(normalized);
        });

        runInAction(() => {
          this.fileName = file.name;
          this.claims = nextClaims;
          this.rowIssues = nextRowIssues;
          this.parseError = results.errors[0]?.message ?? null;
          this.syncGroupApprovals();
          this.isParsing = false;
        });
      },
      error: (error) => {
        runInAction(() => {
          this.parseError = error.message;
          this.isParsing = false;
        });
      },
    });
  }

  approveAllGroups(): void {
    const groups = buildGroupAccumulators(this.claims, this.groupingMethod);
    const groupClaims = buildGroupClaimMap(this.claims, this.groupingMethod);
    const nextApprovedClaims: Record<string, boolean> = {};

    for (const group of groups.values()) {
      const isEligibleGroup =
        group.eligibleClaimCount > 0 && group.invalidClaimCount === 0 && group.deniedClaimCount === 0;
      if (!isEligibleGroup) {
        continue;
      }

      const claims = groupClaims.get(group.id) ?? [];
      for (const claim of claims) {
        if (isEligibleClaim(claim)) {
          nextApprovedClaims[claim.id] = true;
        }
      }
    }

    this.approvedClaims = nextApprovedClaims;
    this.syncGroupApprovals();
  }

  clearGroupApprovals(): void {
    this.approvedClaims = {};
    this.syncGroupApprovals();
  }

  setGroupApproval(id: string, approved: boolean): void {
    const group = this.groupSummaries.find((item) => item.id === id);
    if (!group || !group.isEligible) {
      return;
    }

    const groupClaims = buildGroupClaimMap(this.claims, this.groupingMethod).get(id) ?? [];
    const nextApprovedClaims = { ...this.approvedClaims };

    for (const claim of groupClaims) {
      if (!isEligibleClaim(claim)) {
        continue;
      }
      if (approved) {
        nextApprovedClaims[claim.id] = true;
      } else {
        delete nextApprovedClaims[claim.id];
      }
    }

    this.approvedClaims = nextApprovedClaims;
    this.syncGroupApprovals();
  }

  private syncGroupApprovals(): void {
    const groups = buildGroupAccumulators(this.claims, this.groupingMethod);
    const groupClaims = buildGroupClaimMap(this.claims, this.groupingMethod);
    const nextApprovals: Record<string, boolean> = {};

    for (const group of groups.values()) {
      if (group.eligibleClaimCount === 0 || group.invalidClaimCount > 0 || group.deniedClaimCount > 0) {
        nextApprovals[group.id] = false;
        continue;
      }

      const claims = groupClaims.get(group.id) ?? [];
      const eligibleClaims = claims.filter((claim) => isEligibleClaim(claim));
      nextApprovals[group.id] =
        eligibleClaims.length > 0 && eligibleClaims.every((claim) => this.approvedClaims[claim.id]);
    }

    this.groupApprovals = nextApprovals;
  }

  removeClaim(id: string): void {
    this.claims = this.claims.filter((claim) => claim.id !== id);
    const { [id]: _removed, ...rest } = this.rowIssues;
    this.rowIssues = rest;
    const { [id]: _approved, ...remainingApprovals } = this.approvedClaims;
    this.approvedClaims = remainingApprovals;
    this.syncGroupApprovals();
  }

  updateClaimField(id: string, field: keyof ClaimRow, value: unknown): void {
    const claim = this.claims.find((item) => item.id === id);
    if (!claim) {
      return;
    }

    if (NUMBER_FIELDS.has(field)) {
      const numericValue = Number.parseFloat(String(value));
      (claim as any)[field] = Number.isFinite(numericValue) ? numericValue : Number.NaN;
    } else {
      (claim as any)[field] = typeof value === "string" ? value.trim() : (value as ClaimRow[typeof field]);
    }

    const issues = validateClaim(claim);
    claim.isValid = issues.length === 0;

    if (issues.length > 0) {
      this.rowIssues = { ...this.rowIssues, [claim.id]: issues };
    } else {
      const { [claim.id]: _removed, ...rest } = this.rowIssues;
      this.rowIssues = rest;
    }

    if (!isEligibleClaim(claim) && this.approvedClaims[claim.id]) {
      const { [claim.id]: _removedApproval, ...restApprovals } = this.approvedClaims;
      this.approvedClaims = restApprovals;
    }

    this.syncGroupApprovals();
  }

  async submitApprovedClaims(): Promise<void> {
    this.isSubmitting = true;
    this.submitError = null;
    this.submitResult = [];

    try {
      const approved = this.claims.filter(
        (claim) =>
          isEligibleClaim(claim) && Boolean(this.groupApprovals[getGroupKey(claim, this.groupingMethod)])
      );
      if (approved.length === 0) {
        throw new Error("No approved pricing groups to submit.");
      }

      const response = await createMrfFiles(approved.map(toClaimInput));
      runInAction(() => {
        this.submitResult = response.generated ?? [];
      });
    } catch (error) {
      runInAction(() => {
        this.submitError = error instanceof Error ? error.message : "Failed to submit claims.";
      });
    } finally {
      runInAction(() => {
        this.isSubmitting = false;
      });
    }
  }

  async fetchMrfs(customerId?: string): Promise<void> {
    this.mrfLoading = true;
    this.mrfError = null;

    try {
      const response = await fetchMrfList(customerId);
      runInAction(() => {
        this.mrfCustomers = response.customers ?? [];
      });
    } catch (error) {
      runInAction(() => {
        this.mrfError = error instanceof Error ? error.message : "Failed to fetch MRF files.";
      });
    } finally {
      runInAction(() => {
        this.mrfLoading = false;
      });
    }
  }
}

export const appStore = new AppStore();

export function useAppStore(): AppStore {
  return appStore;
}
