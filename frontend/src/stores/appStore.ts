/**
 * Central MobX store for managing claim data processing, validation, grouping, and MRF submission.
 * Handles CSV parsing, inline claim edits, approval workflows, and backend synchronization.
 */
import { makeAutoObservable, runInAction } from "mobx";
import Papa from "papaparse";
import { z } from "zod";
import { createMrfFiles, fetchMrfList } from "~/services/api";

// ============================================================================
// VALIDATION PATTERNS
// ============================================================================

/** Regex pattern for ISO 8601 date format (YYYY-MM-DD) */
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

/** Regex pattern for 10-digit NPI provider IDs */
const providerIdRegex = /^\d{10}$/;

/** Set of valid claim type values */
const claimTypeSet = new Set(["professional", "institutional"]);

// ============================================================================
// SERVICE CODE MAPPING
// ============================================================================

/**
 * Maps place of service descriptions to standardized service codes.
 * Used for MRF standard grouping and institutional billing classification.
 */
const SERVICE_CODE_MAP: Record<string, string> = {
  "inpatient hospital": "21",
  "outpatient hospital": "22",
  "emergency room - hospital": "23",
  "ambulatory surgical center": "24",
  "urgent care": "20",
  "office": "11",
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** Billing class categorizes claims as professional or institutional */
type BillingClass = "professional" | "institutional";

/**
 * Defines how pricing groups are aggregated.
 * Determines which claim attributes form the grouping key.
 */
export type GroupingMethod = "mrf" | "providerProcedure" | "provider" | "procedure" | "planProcedure";

/** Individual field that contributes to a grouping key */
type GroupKeyField = "customerId" | "providerId" | "procedureCode" | "billingClass" | "serviceCode" | "planId";

/**
 * Configuration for a grouping method.
 * Links the method to its UI label, description, and key fields.
 */
type GroupingDefinition = {
  value: GroupingMethod;
  label: string;
  description: string;
  keyFields: GroupKeyField[];
};

/**
 * Individual claim data read from CSV with validation metadata.
 * rowIndex is 1-based for user-facing error messages.
 */
export type ClaimRow = z.infer<typeof claimSchema> & {
  id: string;
  rowIndex: number;
  isValid: boolean;
};

/** ClaimRow without auto-generated metadata; used for API submissions */
export type ClaimInput = Omit<ClaimRow, "id" | "rowIndex" | "isValid">;

/**
 * Aggregated summary of claims grouped by the current grouping method.
 * Includes totals, counts, and eligibility metadata for UI filtering and approvals.
 */
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

/** Validation error for a specific claim field at a specific row */
export type ValidationIssue = {
  rowIndex: number;
  field: string;
  message: string;
};

/** Backend record of a generated MRF file */
export type MrfFileRecord = {
  customerId: string;
  customerKey: string;
  customerName: string;
  fileName: string;
  createdAt: string;
  claimCount: number;
  size: number;
};

/** Backend record of a customer with their associated MRF files */
export type MrfCustomerRecord = {
  id: string;
  key: string;
  name: string;
  files: MrfFileRecord[];
};

/** Raw row from CSV parsing (all values are strings) */
type RawRow = Record<string, string>;

/**
 * Intermediate accumulator for aggregating claims into groups.
 * Computed per grouping method and converted to PricingGroup for display.
 */
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

/**
 * Component parts used to construct a group key.
 * Maps field names to their values for key generation.
 */
type GroupKeyParts = {
  customerId: string;
  providerId: string;
  procedureCode: string;
  billingClass: BillingClass;
  serviceCode?: string;
  planId: string;
};

// ============================================================================
// GROUPING CONFIGURATIONS
// ============================================================================

/**
 * All available grouping methods with metadata for UI and aggregation logic.
 * Used to drive dropdown options, descriptions, and key field selection.
 */
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

/**
 * Fast lookup map from grouping method to its configuration.
 * Enables O(1) access to grouping metadata.
 */
const GROUPING_CONFIGS = GROUPING_DEFINITIONS.reduce(
  (acc, definition) => {
    acc[definition.value] = definition;
    return acc;
  },
  {} as Record<GroupingMethod, GroupingDefinition>
);

// ============================================================================
// VALIDATION SCHEMA
// ============================================================================

/**
 * Zod schema validating claim field types, formats, and required dependencies.
 * Base schema used for both CSV import validation and inline field edits.
 * Enforces that groupId or groupName is present (not both absent).
 */
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
    // Custom validation: at least one of groupId or groupName must be provided
    if (!value.groupId && !value.groupName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groupId"],
        message: "Group ID or Group Name is required.",
      });
    }
  });

/** Set of field names that should be coerced to numbers during inline edits */
const NUMBER_FIELDS = new Set<keyof ClaimRow>(["memberSequence", "billed", "allowed", "paid"]);

// ============================================================================
// DEMO CREDENTIALS
// ============================================================================

/** Hardcoded credentials for demo/sandbox authentication */
const DEMO_CREDENTIALS = {
  username: "demo",
  password: "demo",
};

// ============================================================================
// CLAIM STATUS CLASSIFICATION
// ============================================================================

/** Set of claim status values that indicate the claim was denied */
const DENIED_STATUSES = new Set(["denied", "reject", "rejected"]);

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse a numeric string from CSV, handling commas and whitespace.
 * @param value - Raw string value from CSV
 * @returns Parsed number, or NaN if parsing fails
 */
function parseNumber(value: string | undefined): number {
  const normalized = value?.replace(/,/g, "").trim();
  const parsed = Number.parseFloat(normalized ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Round a number to 2 decimal places for currency display.
 * @param value - Numeric value to round
 * @returns Rounded value, or 0 if not finite
 */
function roundCurrency(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

/**
 * Determine billing class from claim type.
 * @param claimType - Raw claim type string from CSV
 * @returns Normalized billing class (professional or institutional)
 */
function getBillingClass(claimType: string): BillingClass {
  return claimType?.trim().toLowerCase() === "professional" ? "professional" : "institutional";
}

/**
 * Map place of service to a standardized service code.
 * Used for MRF-compliant grouping.
 * @param placeOfService - Raw place of service string
 * @returns Service code, or "99" if not found in map
 */
function getServiceCode(placeOfService: string): string {
  const normalized = placeOfService?.trim().toLowerCase();
  return SERVICE_CODE_MAP[normalized] ?? "99";
}

/**
 * Extract customer ID from a claim, preferring groupId if available.
 * @param claim - Claim row to extract from
 * @returns Customer identifier for grouping
 */
function getCustomerId(claim: ClaimRow): string {
  return claim.groupId?.trim() || claim.groupName?.trim() || "unknown";
}

/**
 * Check if a claim status indicates denial.
 * @param status - Raw claim status string
 * @returns True if status matches denied/rejected patterns
 */
export function isDeniedStatus(status: string): boolean {
  return DENIED_STATUSES.has(status?.trim().toLowerCase());
}

/**
 * Determine if a claim is eligible for MRF submission.
 * A claim is eligible if it's valid and not denied.
 * @param claim - Claim to check
 * @returns True if eligible
 */
function isEligibleClaim(claim: ClaimRow): boolean {
  return claim.isValid && !isDeniedStatus(claim.claimStatus);
}

/**
 * Normalize a key-part value for group key generation.
 * Trims whitespace and provides a fallback for empty strings.
 * @param value - Raw value to normalize
 * @param fallback - Default value if input is empty (default: "unknown")
 * @returns Normalized value
 */
function normalizeKeyPart(value: string | undefined, fallback = "unknown"): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Normalize a display value for presentation in the UI.
 * Trims whitespace and provides a fallback for empty strings.
 * @param value - Raw value to normalize
 * @param fallback - Default value if input is empty (default: "Unknown")
 * @returns Normalized value
 */
function normalizeDisplayValue(value: string | undefined, fallback = "Unknown"): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Format a set of values for display.
 * Shows single values, "Multiple (N)" for multiple, or a placeholder if empty.
 * @param values - Set of values to format
 * @param emptyLabel - Label to show if set is empty (default: "-")
 * @returns Formatted display string
 */
function formatSetValue(values: Set<string>, emptyLabel = "-"): string {
  if (values.size === 0) {
    return emptyLabel;
  }
  if (values.size === 1) {
    return Array.from(values)[0];
  }
  return `Multiple (${values.size})`;
}

/**
 * Compare two sort value arrays lexicographically (case-insensitive).
 * Used for consistent group sorting across different fields.
 * @param left - First array to compare
 * @param right - Second array to compare
 * @returns Comparison result (-1, 0, or 1)
 */
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

/**
 * Map from group key field to a function that extracts sortable values from a PricingGroup.
 * Enables consistent sorting regardless of grouping method.
 */
const GROUP_SORT_ACCESSORS: Record<GroupKeyField, (group: PricingGroup) => string[]> = {
  customerId: (group) => [group.customerName, group.customerId],
  providerId: (group) => [group.providerName, group.providerId],
  procedureCode: (group) => [group.procedureCode],
  billingClass: (group) => [group.billingClass],
  serviceCode: (group) => [group.serviceCode ?? ""],
  planId: (group) => [group.planName, group.planId],
};

/**
 * Build a group aggregation key from a grouping method and key parts.
 * The key determines which claims belong to the same pricing group.
 * @param groupingMethod - Current grouping strategy
 * @param parts - Individual components of the key
 * @returns Pipe-delimited key string
 */
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

/**
 * Compute the group key for a specific claim under the current grouping method.
 * @param claim - Claim to compute key for
 * @param groupingMethod - Current grouping strategy
 * @returns Group key string
 */
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

/**
 * Build a space-separated search text from group metadata.
 * Enables full-text filtering of groups in the UI.
 * @param group - Group accumulator to index
 * @returns Search text string
 */
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

// ============================================================================
// GROUP AGGREGATION FUNCTIONS
// ============================================================================

/**
 * Build a lookup map from group key to the claims in that group.
 * Used for syncing approval state and computing per-group eligibility.
 * @param claims - All claims to group
 * @param groupingMethod - Current grouping strategy
 * @returns Map of group key -> claims in that group
 */
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

/**
 * Aggregate claim metrics and metadata by group key.
 * Computes totals, counts, and eligibility flags for UI display and approval gating.
 * @param claims - All claims to aggregate
 * @param groupingMethod - Current grouping strategy
 * @returns Map of group key -> aggregated metrics
 */
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

    // Initialize group accumulator if not present
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

    // Aggregate metrics
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

    // Track validity and eligibility
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

// ============================================================================
// CSV PARSING & VALIDATION
// ============================================================================

/**
 * Convert a raw CSV row to a normalized ClaimRow.
 * Applies field extraction, type coercion, and trimming.
 * @param row - Raw row from CSV parser
 * @param rowIndex - 0-based index of row in CSV
 * @returns Normalized claim row (validation status set to true initially)
 */
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

/**
 * Convert a ClaimRow to a ClaimInput for API submission.
 * Strips out auto-generated metadata (id, rowIndex, isValid).
 * @param claim - Claim row to convert
 * @returns Claim input without metadata
 */
function toClaimInput(claim: ClaimRow): ClaimInput {
  const { id, rowIndex, isValid, ...rest } = claim;
  return rest;
}

/**
 * Validate a claim against the schema and return any issues.
 * @param claim - Claim to validate
 * @returns Array of validation issues (empty if valid)
 */
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

// ============================================================================
// MOBX STORE
// ============================================================================

/**
 * Central MobX store managing the complete claim workflow:
 * - CSV parsing and field normalization
 * - Real-time claim validation
 * - Dynamic grouping and aggregation
 * - Approval state management
 * - Backend synchronization (submit, fetch MRF files)
 *
 * All reactive state updates trigger UI re-renders via MobX observation.
 */
class AppStore {
  /** Name of the currently loaded CSV file */
  fileName: string | null = null;

  /** All parsed and normalized claims */
  claims: ClaimRow[] = [];

  /** Validation issues indexed by claim ID */
  rowIssues: Record<string, ValidationIssue[]> = {};

  /** Error message from CSV parsing (if any) */
  parseError: string | null = null;

  /** Flag indicating ongoing CSV parse operation */
  isParsing = false;

  /** Approval state per group (group ID -> approved) */
  groupApprovals: Record<string, boolean> = {};

  /** Approval state per claim (claim ID -> approved) */
  approvedClaims: Record<string, boolean> = {};

  /** Current grouping method */
  groupingMethod: GroupingMethod = "mrf";

  /** Flag indicating ongoing MRF submission */
  isSubmitting = false;

  /** Error message from MRF submission (if any) */
  submitError: string | null = null;

  /** Records of successfully generated MRF files */
  submitResult: MrfFileRecord[] = [];

  /** Fetched MRF customer records from backend */
  mrfCustomers: MrfCustomerRecord[] = [];

  /** Flag indicating ongoing MRF list fetch */
  mrfLoading = false;

  /** Error message from MRF fetch (if any) */
  mrfError: string | null = null;

  /** Whether user is authenticated */
  isAuthenticated = false;

  /** Authentication error message (if any) */
  authError: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  // ========================================================================
  // COMPUTED STATE
  // ========================================================================

  /** Count of valid claims (no validation errors) */
  get validCount(): number {
    return this.claims.filter((claim) => claim.isValid).length;
  }

  /** Count of eligible claims (valid and not denied) */
  get eligibleCount(): number {
    return this.claims.filter((claim) => isEligibleClaim(claim)).length;
  }

  /** All claims that fail validation */
  get invalidClaims(): ClaimRow[] {
    return this.claims.filter((claim) => !claim.isValid);
  }

  /** All claims with denied status */
  get deniedClaims(): ClaimRow[] {
    return this.claims.filter((claim) => isDeniedStatus(claim.claimStatus));
  }

  /** All claims requiring attention (invalid or denied) */
  get attentionClaims(): ClaimRow[] {
    return this.claims.filter((claim) => !claim.isValid || isDeniedStatus(claim.claimStatus));
  }

  /** Count of invalid claims */
  get invalidCount(): number {
    return this.invalidClaims.length;
  }

  /** Count of denied claims */
  get deniedCount(): number {
    return this.deniedClaims.length;
  }

  /** Count of claims requiring attention */
  get attentionCount(): number {
    return this.attentionClaims.length;
  }

  /** Available grouping options for UI dropdown */
  get groupingOptions(): { value: GroupingMethod; label: string }[] {
    return GROUPING_DEFINITIONS.map(({ value, label }) => ({ value, label }));
  }

  /** Description of the current grouping method */
  get groupingDescription(): string {
    return GROUPING_CONFIGS[this.groupingMethod].description;
  }

  /** Label of the current grouping method */
  get groupingLabel(): string {
    return GROUPING_CONFIGS[this.groupingMethod].label;
  }

  /** Key fields used in the current grouping method */
  get groupingKeyFields(): GroupKeyField[] {
    return GROUPING_CONFIGS[this.groupingMethod].keyFields;
  }

  /** Whether the current grouping method includes plan ID */
  get groupingUsesPlan(): boolean {
    return this.groupingKeyFields.includes("planId");
  }

  /** Whether the current grouping method includes provider ID */
  get groupingUsesProvider(): boolean {
    return this.groupingKeyFields.includes("providerId");
  }

  /** Whether the current grouping method includes procedure code */
  get groupingUsesProcedure(): boolean {
    return this.groupingKeyFields.includes("procedureCode");
  }

  /** Whether the current grouping method includes service code */
  get groupingUsesServiceCode(): boolean {
    return this.groupingKeyFields.includes("serviceCode");
  }

  /**
   * Aggregated summaries of claims grouped by the current grouping method.
   * Sorted according to the current grouping's key fields.
   * This is the primary data source for the groups grid UI.
   */
  get groupSummaries(): PricingGroup[] {
    const groups = buildGroupAccumulators(this.claims, this.groupingMethod);
    const summaries: PricingGroup[] = [];

    for (const group of groups.values()) {
      // Compute averages only for eligible claims
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

      // Format set values for display
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

    // Sort groups by their grouping method's key fields
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

  /** Count of groups */
  get groupCount(): number {
    return this.groupSummaries.length;
  }

  /** Count of approved groups */
  get approvedGroupCount(): number {
    return this.groupSummaries.filter((group) => group.approved).length;
  }

  /** Count of claims in approved groups that are also eligible */
  get approvedClaimCount(): number {
    return this.claims.filter(
      (claim) =>
        isEligibleClaim(claim) && Boolean(this.groupApprovals[getGroupKey(claim, this.groupingMethod)])
    ).length;
  }

  /** Whether any claims have been loaded */
  get hasClaims(): boolean {
    return this.claims.length > 0;
  }

  /** All validation issues across all claims */
  get validationIssues(): ValidationIssue[] {
    return Object.values(this.rowIssues).flat();
  }

  // ========================================================================
  // AUTHENTICATION
  // ========================================================================

  /**
   * Attempt to authenticate with provided credentials.
   * Updates isAuthenticated and authError accordingly.
   * @param username - Username to authenticate
   * @param password - Password to authenticate
   */
  login(username: string, password: string): void {
    if (username === DEMO_CREDENTIALS.username && password === DEMO_CREDENTIALS.password) {
      this.isAuthenticated = true;
      this.authError = null;
    } else {
      this.authError = "Invalid credentials.";
    }
  }

  /**
   * Log out the current user and reset all state.
   * Clears claims, approvals, and any submission results.
   */
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

  // ========================================================================
  // GROUPING & AGGREGATION
  // ========================================================================

  /**
   * Change the grouping method and resync all approval state.
   * No-op if the new method is the same as the current method.
   * @param method - New grouping method to apply
   */
  setGroupingMethod(method: GroupingMethod): void {
    if (method === this.groupingMethod) {
      return;
    }
    this.groupingMethod = method;
    this.syncGroupApprovals();
  }

  // ========================================================================
  // CSV PARSING
  // ========================================================================

  /**
   * Parse a CSV file into normalized and validated claims.
   * Clears all previous state (claims, approvals, errors) to keep state coherent.
   * Uses PapaParse to handle CSV parsing with streaming error handling.
   * @param file - CSV File object to parse
   */
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

        // Process each row: normalize and validate
        results.data.forEach((row, index) => {
          const normalized = normalizeRow(row, index);
          const issues = validateClaim(normalized);
          normalized.isValid = issues.length === 0;
          if (issues.length > 0) {
            nextRowIssues[normalized.id] = issues;
          }
          nextClaims.push(normalized);
        });

        // Update store with batch of claims
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

  // ========================================================================
  // APPROVAL MANAGEMENT
  // ========================================================================

  /**
   * Approve all eligible groups.
   * A group is eligible if it has eligible claims and no invalid/denied claims.
   * Marks all eligible claims within eligible groups as approved.
   */
  approveAllGroups(): void {
    const groups = buildGroupAccumulators(this.claims, this.groupingMethod);
    const groupClaims = buildGroupClaimMap(this.claims, this.groupingMethod);
    const nextApprovedClaims: Record<string, boolean> = {};

    for (const group of groups.values()) {
      // Only approve groups with eligible claims and no invalid/denied claims
      const isEligibleGroup =
        group.eligibleClaimCount > 0 && group.invalidClaimCount === 0 && group.deniedClaimCount === 0;
      if (!isEligibleGroup) {
        continue;
      }

      // Mark all eligible claims in this group as approved
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

  /** Clear all approvals from all claims and groups */
  clearGroupApprovals(): void {
    this.approvedClaims = {};
    this.syncGroupApprovals();
  }

  /**
   * Set approval status for all eligible claims within a specific group.
   * No-op if the group is not eligible or doesn't exist.
   * @param id - Group ID to toggle approval for
   * @param approved - Whether to approve or disapprove the group
   */
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

  /**
   * Recompute per-group approval status from the approved-claims set.
   * Called after grouping changes, claim edits, or approval state updates.
   * Ensures groupApprovals always reflects the current approved claims.
   */
  private syncGroupApprovals(): void {
    const groups = buildGroupAccumulators(this.claims, this.groupingMethod);
    const groupClaims = buildGroupClaimMap(this.claims, this.groupingMethod);
    const nextApprovals: Record<string, boolean> = {};

    for (const group of groups.values()) {
      // Group is not approvable if it has any invalid or denied claims, or no eligible claims
      if (group.eligibleClaimCount === 0 || group.invalidClaimCount > 0 || group.deniedClaimCount > 0) {
        nextApprovals[group.id] = false;
        continue;
      }

      // Group is approved only if all its eligible claims are approved
      const claims = groupClaims.get(group.id) ?? [];
      const eligibleClaims = claims.filter((claim) => isEligibleClaim(claim));
      nextApprovals[group.id] =
        eligibleClaims.length > 0 && eligibleClaims.every((claim) => this.approvedClaims[claim.id]);
    }

    this.groupApprovals = nextApprovals;
  }

  // ========================================================================
  // CLAIM EDITING
  // ========================================================================

  /**
   * Remove a claim from the dataset.
   * Also removes associated validation issues and any approvals for that claim.
   * Resyncs group approvals to maintain consistency.
   * @param id - Claim ID to remove
   */
  removeClaim(id: string): void {
    this.claims = this.claims.filter((claim) => claim.id !== id);
    const { [id]: _removed, ...rest } = this.rowIssues;
    this.rowIssues = rest;
    const { [id]: _approved, ...remainingApprovals } = this.approvedClaims;
    this.approvedClaims = remainingApprovals;
    this.syncGroupApprovals();
  }

  /**
   * Inline edit handler for a single claim field.
   * Updates the value, revalidates the claim, and syncs approvals.
   * Number fields are coerced via parseFloat to maintain consistency with CSV parsing.
   * If a claim becomes ineligible, its approval is cleared.
   * @param id - Claim ID to edit
   * @param field - Field name to update
   * @param value - New value for the field
   */
  updateClaimField(id: string, field: keyof ClaimRow, value: unknown): void {
    const claim = this.claims.find((item) => item.id === id);
    if (!claim) {
      return;
    }

    // Coerce number fields to maintain validation consistency
    if (NUMBER_FIELDS.has(field)) {
      const numericValue = Number.parseFloat(String(value));
      (claim as any)[field] = Number.isFinite(numericValue) ? numericValue : Number.NaN;
    } else {
      (claim as any)[field] = typeof value === "string" ? value.trim() : (value as ClaimRow[typeof field]);
    }

    // Revalidate the claim after edit
    const issues = validateClaim(claim);
    claim.isValid = issues.length === 0;

    // Update validation issues
    if (issues.length > 0) {
      this.rowIssues = { ...this.rowIssues, [claim.id]: issues };
    } else {
      const { [claim.id]: _removed, ...rest } = this.rowIssues;
      this.rowIssues = rest;
    }

    // Clear approval if claim became ineligible
    if (!isEligibleClaim(claim) && this.approvedClaims[claim.id]) {
      const { [claim.id]: _removedApproval, ...restApprovals } = this.approvedClaims;
      this.approvedClaims = restApprovals;
    }

    this.syncGroupApprovals();
  }

  // ========================================================================
  // SUBMISSION
  // ========================================================================

  /**
   * Submit all approved, eligible claims to generate MRF files.
   * Only sends claims that are both eligible and in an approved group.
   * Handles errors gracefully and prevents submission of empty sets.
   */
  async submitApprovedClaims(): Promise<void> {
    this.isSubmitting = true;
    this.submitError = null;
    this.submitResult = [];

    try {
      // Filter to only approved, eligible claims
      const approved = this.claims.filter(
        (claim) =>
          isEligibleClaim(claim) && Boolean(this.groupApprovals[getGroupKey(claim, this.groupingMethod)])
      );
      if (approved.length === 0) {
        throw new Error("No approved pricing groups to submit.");
      }

      // Submit to backend
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

  // ========================================================================
  // MRF FETCHING
  // ========================================================================

  /**
   * Fetch the backend index of generated MRF files.
   * Optionally scope the fetch to a specific customer.
   * Handles errors and manages loading state.
   * @param customerId - Optional customer ID to filter by
   */
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

/** Singleton instance of AppStore */
export const appStore = new AppStore();

/**
 * Hook to access the global AppStore instance.
 * @returns The global AppStore
 */
export function useAppStore(): AppStore {
  return appStore;
}