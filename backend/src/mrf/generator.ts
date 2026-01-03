import { BILLING_CODE_TYPE_VERSION, getBillingClass, getBillingCodeType, getServiceCode, roundCurrency, slugify } from "./utils.js";
import type { ClaimInput, GeneratedMrf, MrfAllowedAmount, MrfFile, MrfOutOfNetwork } from "./types.js";

const DEFAULT_REPORTING_ENTITY_TYPE = "group";
const DEFAULT_VERSION = "1.0.0";

/**
 * Represents a bucket of aggregated billing data for a specific provider and service.
 *
 * @property billingClass - The billing classification, either "professional" or "institutional".
 * @property serviceCode - (Optional) The code identifying the billed service.
 * @property providerId - The unique identifier for the provider.
 * @property providerNpi - The National Provider Identifier (NPI) number for the provider.
 * @property sumAllowed - The total allowed amount for all claims in this bucket.
 * @property sumBilled - The total billed amount for all claims in this bucket.
 * @property count - The number of claims aggregated in this bucket.
 */
type AggregationBucket = {
  billingClass: "professional" | "institutional";
  serviceCode?: string;
  providerId: string;
  providerNpi: number;
  sumAllowed: number;
  sumBilled: number;
  count: number;
};

// Builder pattern for composing MRF payloads.
class MrfBuilder {
  private readonly file: MrfFile;

  constructor(reportingEntityName: string) {
    this.file = {
      reporting_entity_name: reportingEntityName,
      reporting_entity_type: DEFAULT_REPORTING_ENTITY_TYPE,
      last_updated_on: new Date().toISOString().slice(0, 10),
      version: DEFAULT_VERSION,
      out_of_network: [],
    };
  }

  /**
   * Adds an array of out-of-network items to the current file.
   *
   * @param items - An array of `MrfOutOfNetwork` objects to be added to the `out_of_network` list.
   * @returns The current instance for method chaining.
   */
  addOutOfNetwork(items: MrfOutOfNetwork[]): this {
    this.file.out_of_network.push(...items);
    return this;
  }

  build(): MrfFile {
    return this.file;
  }
}

/**
 * Groups an array of claims by their procedure code.
 *
 * Iterates through the provided claims and organizes them into a map,
 * where each key is a procedure code and the value is an array of claims
 * that share that procedure code. Claims without a procedure code are skipped.
 *
 * @param claims - An array of `ClaimInput` objects to be grouped.
 * @returns A `Map` where each key is a procedure code (string) and the value is an array of `ClaimInput` objects with that procedure code.
 */
function groupClaimsByProcedure(claims: ClaimInput[]): Map<string, ClaimInput[]> {
  const map = new Map<string, ClaimInput[]>();
  for (const claim of claims) {
    if (!claim.procedureCode) {
      continue;
    }
    const existing = map.get(claim.procedureCode) ?? [];
    existing.push(claim);
    map.set(claim.procedureCode, existing);
  }
  return map;
}

/**
 * Aggregates claim data to compute average allowed and billed amounts per provider, billing class, and service code.
 *
 * @param claims - An array of `ClaimInput` objects representing individual claims to be aggregated.
 * @returns An array of `MrfAllowedAmount` objects, each representing the aggregated allowed and billed amounts
 *          for a unique combination of provider, billing class, and (optionally) service code.
 *
 * @remarks
 * - Claims without a valid `providerId` are skipped.
 * - The aggregation groups claims by provider ID, billing class (derived from claim type), and service code
 *   (for professional billing class, derived from place of service).
 * - For each group, the function calculates the average allowed and billed amounts, rounding to currency precision.
 * - The resulting structure is suitable for use in MRF (Machine Readable File) generation.
 */
function buildAllowedAmounts(claims: ClaimInput[]): MrfAllowedAmount[] {
  // Aggregate allowed/billed averages by provider, billing class, and service code.
  const buckets = new Map<string, AggregationBucket>();

  for (const claim of claims) {
    // Skip claims without a providerId.
    if (!claim.providerId) {
      continue;
    }

    // Parse provider NPI and skip if invalid.
    const providerNpi = Number.parseInt(claim.providerId, 10);
    if (!Number.isFinite(providerNpi)) {
      continue;
    }

    // Determine billing class and service code (if professional).
    const billingClass = getBillingClass(claim.claimType);
    const serviceCode = billingClass === "professional" ? getServiceCode(claim.placeOfService) : undefined;
    // Create a unique key for the aggregation bucket.
    const key = [claim.providerId, billingClass, serviceCode ?? "none"].join("|");
    // Retrieve or initialize the aggregation bucket.
    const bucket = buckets.get(key) ?? {
      billingClass,
      serviceCode,
      providerId: claim.providerId,
      providerNpi,
      sumAllowed: 0,
      sumBilled: 0,
      count: 0,
    };

    // Accumulate allowed and billed amounts, and increment count.
    bucket.sumAllowed += Number(claim.allowed) || 0;
    bucket.sumBilled += Number(claim.billed) || 0;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const allowedAmounts: MrfAllowedAmount[] = [];

  for (const bucket of buckets.values()) {
    // Calculate average allowed and billed amounts, rounded to currency precision.
    const averageAllowed = roundCurrency(bucket.sumAllowed / bucket.count);
    const averageBilled = roundCurrency(bucket.sumBilled / bucket.count);
    const npi = [bucket.providerNpi];

    // Build the MrfAllowedAmount entry.
    const entry: MrfAllowedAmount = {
      tin: {
        type: "npi",
        value: bucket.providerId,
      },
      billing_class: bucket.billingClass,
      payments: [
        {
          allowed_amount: averageAllowed,
          providers: [
            {
              billed_charge: averageBilled,
              npi,
            },
          ],
        },
      ],
    };

    // Add service_code if billing class is professional.
    if (bucket.billingClass === "professional" && bucket.serviceCode) {
      entry.service_code = [bucket.serviceCode];
    }

    allowedAmounts.push(entry);
  }

  return allowedAmounts;
}

function buildOutOfNetwork(claims: ClaimInput[]): MrfOutOfNetwork[] {
  const byProcedure = groupClaimsByProcedure(claims);
  const outOfNetwork: MrfOutOfNetwork[] = [];

  for (const [procedureCode, procedureClaims] of byProcedure.entries()) {
    const allowedAmounts = buildAllowedAmounts(procedureClaims);
    if (allowedAmounts.length === 0) {
      continue;
    }

    outOfNetwork.push({
      name: `Procedure ${procedureCode}`,
      billing_code_type: getBillingCodeType(procedureCode),
      billing_code_type_version: BILLING_CODE_TYPE_VERSION,
      billing_code: procedureCode,
      description: `Allowed amounts for procedure ${procedureCode}.`,
      allowed_amounts: allowedAmounts,
    });
  }

  return outOfNetwork;
}

function groupClaimsByCustomer(claims: ClaimInput[]): Map<string, ClaimInput[]> {
  const map = new Map<string, ClaimInput[]>();
  for (const claim of claims) {
    const customerId = claim.groupId?.trim() || claim.groupName?.trim() || "unknown";
    const existing = map.get(customerId) ?? [];
    existing.push(claim);
    map.set(customerId, existing);
  }
  return map;
}

export function generateMrfFiles(claims: ClaimInput[]): GeneratedMrf[] {
  const byCustomer = groupClaimsByCustomer(claims);
  const today = new Date().toISOString().slice(0, 10);
  const generated: GeneratedMrf[] = [];

  for (const [customerId, customerClaims] of byCustomer.entries()) {
    const customerName = customerClaims[0]?.groupName || customerId;
    const builder = new MrfBuilder(customerName);
    const outOfNetwork = buildOutOfNetwork(customerClaims);
    if (outOfNetwork.length === 0) {
      continue;
    }
    const data = builder.addOutOfNetwork(outOfNetwork).build();

    const customerKey = slugify(customerId);
    const fileName = `${slugify(customerName)}-${customerKey}-${today}.json`;

    generated.push({
      customerId,
      customerKey,
      customerName,
      fileName,
      claimCount: customerClaims.length,
      data,
    });
  }

  return generated;
}
