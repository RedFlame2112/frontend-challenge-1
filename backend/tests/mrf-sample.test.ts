import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { generateMrfFiles } from "../src/mrf/generator.js";
import type { ClaimInput } from "../src/mrf/types.js";

type CsvRow = Record<string, string>;

function parseNumber(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapRowToClaim(row: CsvRow): ClaimInput {
  return {
    claimId: (row["Claim ID"] ?? "").trim(),
    groupId: (row["Group ID"] ?? "").trim(),
    groupName: (row["Group Name"] ?? "").trim(),
    planName: (row["Plan"] ?? "").trim(),
    planId: (row["Plan ID"] ?? "").trim(),
    placeOfService: (row["Place of Service"] ?? "").trim(),
    claimType: (row["Claim Type"] ?? "").trim(),
    procedureCode: (row["Procedure Code"] ?? "").trim(),
    providerId: (row["Provider ID"] ?? "").trim(),
    providerName: (row["Provider Name"] ?? "").trim(),
    billed: parseNumber(row["Billed"]),
    allowed: parseNumber(row["Allowed"]),
    paid: parseNumber(row["Paid"]),
  };
}

function loadSampleClaims(): { claims: ClaimInput[]; groupKeys: Set<string> } {
  const samplePath = path.resolve(process.cwd(), "..", "data", "sample.csv");
  const csv = fs.readFileSync(samplePath, "utf8");
  const parsed = Papa.parse<CsvRow>(csv, { header: true, skipEmptyLines: true });

  assert.equal(parsed.errors.length, 0, "Sample CSV should parse without errors.");

  const rows = parsed.data.filter((row) => Object.keys(row).length > 0);
  const claims = rows.map(mapRowToClaim);

  const groupKeys = new Set(
    rows.map((row) => {
      const groupId = (row["Group ID"] ?? "").trim();
      if (groupId) {
        return groupId;
      }
      const groupName = (row["Group Name"] ?? "").trim();
      return groupName || "unknown";
    })
  );

  return { claims, groupKeys };
}

(() => {
  const { claims, groupKeys } = loadSampleClaims();
  const generated = generateMrfFiles(claims);

  assert.equal(
    generated.length,
    groupKeys.size,
    "MRF generation should create one file per customer group."
  );

  const totalClaims = generated.reduce((sum, file) => sum + file.claimCount, 0);
  assert.equal(
    totalClaims,
    claims.length,
    "All claims should be represented across generated MRF files."
  );

  const emptyOutOfNetwork = generated.filter((file) => file.data.out_of_network.length === 0);
  assert.equal(
    emptyOutOfNetwork.length,
    0,
    "Each generated MRF should contain out_of_network entries."
  );

  console.log("mrf-sample: OK");
})();

(() => {
  const claims: ClaimInput[] = [
    {
      claimId: "1",
      groupId: "",
      groupName: "Alpha Group",
      planName: "Plan A",
      planId: "PLA001",
      placeOfService: "Office",
      claimType: "Professional",
      procedureCode: "99213",
      providerId: "1111111111",
      providerName: "Provider One",
      billed: 100,
      allowed: 80,
      paid: 60,
    },
    {
      claimId: "2",
      groupId: "",
      groupName: "Beta Group",
      planName: "Plan B",
      planId: "PLB001",
      placeOfService: "Office",
      claimType: "Professional",
      procedureCode: "99214",
      providerId: "2222222222",
      providerName: "Provider Two",
      billed: 120,
      allowed: 90,
      paid: 70,
    },
  ];

  const generated = generateMrfFiles(claims);
  assert.equal(generated.length, 2, "Fallback grouping should split by group name.");
  assert.equal(generated[0].claimCount, 1);
  assert.equal(generated[1].claimCount, 1);

  console.log("mrf-fallback-grouping: OK");
})();
