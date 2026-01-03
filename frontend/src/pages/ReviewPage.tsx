import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColGroupDef, RowClassRules } from "ag-grid-community";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  MultiSelect,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Link } from "react-router-dom";
import { isDeniedStatus, useAppStore, type ClaimRow, type GroupingMethod, type PricingGroup } from "~/stores/appStore";
import StatBadge from "~/components/StatBadge";
import { formatCurrency } from "~/utils/formatters";

type SelectOption = { value: string; label: string };
type EditableField =
  | "claimStatus"
  | "claimType"
  | "procedureCode"
  | "billed"
  | "allowed"
  | "paid"
  | "paymentStatusDate"
  | "serviceDate"
  | "groupName"
  | "groupId"
  | "providerName"
  | "providerId"
  | "placeOfService"
  | "planName"
  | "planId"
  | "paymentStatus";

const EDITABLE_FIELDS: { field: EditableField; label: string; inputType?: "number" | "date" }[] = [
  { field: "claimStatus", label: "Claim status" },
  { field: "claimType", label: "Claim type" },
  { field: "procedureCode", label: "Procedure code" },
  { field: "billed", label: "Billed", inputType: "number" },
  { field: "allowed", label: "Allowed", inputType: "number" },
  { field: "paid", label: "Paid", inputType: "number" },
  { field: "paymentStatus", label: "Payment status" },
  { field: "paymentStatusDate", label: "Payment status date", inputType: "date" },
  { field: "serviceDate", label: "Service date", inputType: "date" },
  { field: "groupName", label: "Group name" },
  { field: "groupId", label: "Group ID" },
  { field: "providerName", label: "Provider name" },
  { field: "providerId", label: "Provider ID" },
  { field: "placeOfService", label: "Place of service" },
  { field: "planName", label: "Plan name" },
  { field: "planId", label: "Plan ID" },
];

function formatOptionLabel(primary: string, secondary?: string): string {
  if (!secondary || secondary === primary) {
    return primary;
  }
  return `${primary} (${secondary})`;
}

function buildFilterOptions(
  groups: PricingGroup[],
  getValue: (group: PricingGroup) => string | undefined,
  getLabel?: (group: PricingGroup) => string | undefined
): SelectOption[] {
  const options = new Map<string, string>();

  for (const group of groups) {
    const value = getValue(group)?.trim();
    if (!value) {
      continue;
    }
    const label = getLabel?.(group)?.trim() || value;
    options.set(value, label);
  }

  return Array.from(options.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function needsGroupAttention(group?: PricingGroup | null): boolean {
  if (!group) {
    return false;
  }
  return group.invalidClaimCount > 0 || group.deniedClaimCount > 0 || group.eligibleClaimCount === 0;
}

function ReviewPage() {
  const store = useAppStore();
  const [groupFilter, setGroupFilter] = useState("all");
  const [groupSearch, setGroupSearch] = useState("");
  const [customerFilters, setCustomerFilters] = useState<string[]>([]);
  const [planFilters, setPlanFilters] = useState<string[]>([]);
  const [providerFilters, setProviderFilters] = useState<string[]>([]);
  const [procedureFilters, setProcedureFilters] = useState<string[]>([]);
  const [billingClassFilters, setBillingClassFilters] = useState<string[]>([]);
  const [serviceCodeFilters, setServiceCodeFilters] = useState<string[]>([]);
  const [issueFilter, setIssueFilter] = useState("all");
  const [issueSearch, setIssueSearch] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("groups");
  const [editClaimId, setEditClaimId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Record<EditableField, string | number>>>({});

  useEffect(() => {
    setSelectedGroupIds([]);
    setGroupSearch("");
    setCustomerFilters([]);
    setPlanFilters([]);
    setProviderFilters([]);
    setProcedureFilters([]);
    setBillingClassFilters([]);
    setServiceCodeFilters([]);
  }, [store.groupingMethod]);

  const groupFilterOptions = useMemo(() => {
    // Build filter option lists from the current group summaries.
    const groups = store.groupSummaries;

    return {
      customers: buildFilterOptions(groups, (group) => group.customerId, (group) =>
        formatOptionLabel(group.customerName, group.customerId)
      ),
      plans: buildFilterOptions(groups, (group) => group.planId, (group) =>
        formatOptionLabel(group.planName, group.planId)
      ),
      providers: buildFilterOptions(groups, (group) => group.providerId, (group) =>
        formatOptionLabel(group.providerName, group.providerId)
      ),
      procedures: buildFilterOptions(groups, (group) => group.procedureCode),
      billingClasses: buildFilterOptions(groups, (group) => group.billingClass),
      serviceCodes: buildFilterOptions(groups, (group) => group.serviceCode),
    };
  }, [store.groupSummaries]);

  const hasActiveGroupFilters =
    groupFilter !== "all" ||
    groupSearch.trim().length > 0 ||
    customerFilters.length > 0 ||
    planFilters.length > 0 ||
    providerFilters.length > 0 ||
    procedureFilters.length > 0 ||
    billingClassFilters.length > 0 ||
    serviceCodeFilters.length > 0;

  const clearGroupFilters = () => {
    setGroupFilter("all");
    setGroupSearch("");
    setCustomerFilters([]);
    setPlanFilters([]);
    setProviderFilters([]);
    setProcedureFilters([]);
    setBillingClassFilters([]);
    setServiceCodeFilters([]);
  };

  const baseFilteredGroups = useMemo(() => {
    const searchValue = groupSearch.trim().toLowerCase();
    let groups = store.groupSummaries;

    if (customerFilters.length > 0) {
      groups = groups.filter((group) => customerFilters.includes(group.customerId));
    }

    if (store.groupingUsesPlan && planFilters.length > 0) {
      groups = groups.filter((group) => planFilters.includes(group.planId));
    }

    if (store.groupingUsesProvider && providerFilters.length > 0) {
      groups = groups.filter((group) => providerFilters.includes(group.providerId));
    }

    if (store.groupingUsesProcedure && procedureFilters.length > 0) {
      groups = groups.filter((group) => procedureFilters.includes(group.procedureCode));
    }

    if (billingClassFilters.length > 0) {
      groups = groups.filter((group) => billingClassFilters.includes(group.billingClass));
    }

    if (store.groupingUsesServiceCode && serviceCodeFilters.length > 0) {
      groups = groups.filter((group) => group.serviceCode && serviceCodeFilters.includes(group.serviceCode));
    }

    if (!searchValue) {
      return groups;
    }

    return groups.filter((group) => group.searchText.includes(searchValue));
  }, [
    groupSearch,
    customerFilters,
    planFilters,
    providerFilters,
    procedureFilters,
    billingClassFilters,
    serviceCodeFilters,
    store.groupSummaries,
    store.groupingUsesPlan,
    store.groupingUsesProvider,
    store.groupingUsesProcedure,
    store.groupingUsesServiceCode,
  ]);

  const filteredGroupCounts = useMemo(() => {
    const total = baseFilteredGroups.length;
    const ready = baseFilteredGroups.filter((group) => group.isEligible).length;
    const attention = baseFilteredGroups.filter((group) => needsGroupAttention(group)).length;
    const approved = baseFilteredGroups.filter((group) => group.approved).length;
    const unapproved = total - approved;

    return {
      total,
      ready,
      attention,
      approved,
      unapproved,
    };
  }, [baseFilteredGroups]);

  const filteredGroups = useMemo(() => {
    if (groupFilter === "ready") {
      return baseFilteredGroups.filter((group) => group.isEligible);
    }
    if (groupFilter === "attention") {
      return baseFilteredGroups.filter((group) => needsGroupAttention(group));
    }
    if (groupFilter === "approved") {
      return baseFilteredGroups.filter((group) => group.approved);
    }
    if (groupFilter === "unapproved") {
      return baseFilteredGroups.filter((group) => !group.approved);
    }

    return baseFilteredGroups;
  }, [baseFilteredGroups, groupFilter]);

  const filteredClaims = useMemo(() => {
    const searchValue = issueSearch.trim().toLowerCase();
    let claims = store.claims;

    if (issueFilter === "invalid") {
      claims = claims.filter((claim) => !claim.isValid);
    } else if (issueFilter === "denied") {
      claims = claims.filter((claim) => isDeniedStatus(claim.claimStatus));
    }

    if (!searchValue) {
      return claims;
    }

    return claims.filter((claim) => {
      return [
        claim.claimId,
        claim.subscriberId,
        claim.groupName,
        claim.groupId,
        claim.providerName,
        claim.providerId,
        claim.procedureCode,
        claim.claimStatus,
      ]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(searchValue));
    });
  }, [issueFilter, issueSearch, store.claims]);

  const currentEditClaim = useMemo(
    () => store.claims.find((claim) => claim.id === editClaimId) ?? null,
    [editClaimId, store.claims]
  );

  const openEditModal = (claim: ClaimRow) => {
    setEditClaimId(claim.id);
    setEditForm({
      claimStatus: claim.claimStatus,
      claimType: claim.claimType,
      procedureCode: claim.procedureCode,
      billed: claim.billed,
      allowed: claim.allowed,
      paid: claim.paid,
      paymentStatus: claim.paymentStatus,
      paymentStatusDate: claim.paymentStatusDate,
      serviceDate: claim.serviceDate,
      groupName: claim.groupName,
      groupId: claim.groupId,
      providerName: claim.providerName,
      providerId: claim.providerId,
      placeOfService: claim.placeOfService,
      planName: claim.planName,
      planId: claim.planId,
    });
  };

  const closeEditModal = () => {
    setEditClaimId(null);
    setEditForm({});
  };

  const handleEditChange = (field: EditableField, value: string | number) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveEditModal = () => {
    if (!currentEditClaim) {
      return;
    }
    for (const [field, value] of Object.entries(editForm)) {
      store.updateClaimField(currentEditClaim.id, field as EditableField, value);
    }
    closeEditModal();
  };

  const goToClaimsForGroup = useCallback((group: PricingGroup) => {
    setIssueFilter("all");
    setIssueSearch(group.customerId || group.customerName || "");
    setActiveTab("edit-claims");
  }, []);

  if (!store.isAuthenticated) {
    return (
      <Stack gap="lg" className="px-4 py-6 md:px-8">
        <Alert color="yellow" title="Authentication required">
          Sign in with demo / demo to review and approve pricing groups.
        </Alert>
        <Button component={Link} to="/upload" variant="light">
          Go to sign in
        </Button>
      </Stack>
    );
  }

  if (!store.hasClaims) {
    return (
      <Stack gap="lg" className="px-4 py-6 md:px-8">
        <Alert color="gray" title="No claims loaded">
          Upload a CSV file to start reviewing pricing groups.
        </Alert>
        <Button component={Link} to="/upload" variant="light">
          Upload claims
        </Button>
      </Stack>
    );
  }

  const groupColumnDefs = useMemo<ColDef<PricingGroup>[]>(
    () => {
      const showPlanColumns = store.groupingUsesPlan;

      return [
        {
          headerName: "Actions",
          minWidth: 170,
          pinned: "left",
          cellRenderer: (params: { data?: PricingGroup }) => {
            const group = params.data;
            if (!group) {
              return null;
            }
            return (
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() => goToClaimsForGroup(group)}
                >
                  Edit claims
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  disabled={!group.isEligible}
                  onClick={() => store.setGroupApproval(group.id, true)}
                >
                  Approve
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  disabled={!group.isEligible}
                  onClick={() => store.setGroupApproval(group.id, false)}
                >
                  Unapprove
                </Button>
              </Group>
            );
          },
        },
        {
          headerName: "Approve",
          field: "approved",
          width: 110,
          editable: (params) => Boolean(params.data?.isEligible),
          cellRenderer: "agCheckboxCellRenderer",
          cellEditor: "agCheckboxCellEditor",
        },
        {
          headerName: "Status",
          minWidth: 160,
          editable: false,
          cellRenderer: (params: { data?: PricingGroup }) => {
            const group = params.data;
            if (!group) {
              return null;
            }

            if (!group.isEligible) {
              if (group.eligibleClaimCount === 0) {
                return <Badge color="red" variant="light">Non eligible claim</Badge>;
              }
              if (group.invalidClaimCount > 0) {
                return <Badge color="orange" variant="light">Invalid data</Badge>;
              }
              if (group.deniedClaimCount > 0) {
                return <Badge color="yellow" variant="light">Denied claims</Badge>;
              }
              return <Badge color="yellow" variant="light">Needs review</Badge>;
            }

            if (group.approved) {
              return <Badge color="green" variant="light">Approved</Badge>;
            }

            return <Badge color="teal" variant="light">Ready</Badge>;
          },
        },
        { headerName: "Customer", field: "customerName", minWidth: 180 },
        { headerName: "Customer ID", field: "customerId", minWidth: 140 },
        { headerName: "Plan", field: "planName", minWidth: 180, hide: !showPlanColumns },
        { headerName: "Plan ID", field: "planId", minWidth: 140, hide: !showPlanColumns },
        { headerName: "Procedure", field: "procedureCode", minWidth: 120 },
        { headerName: "Provider", field: "providerName", minWidth: 180 },
        { headerName: "Provider ID", field: "providerId", minWidth: 140 },
        { headerName: "Billing Class", field: "billingClass", minWidth: 140 },
        {
          headerName: "Service Code",
          field: "serviceCode",
          minWidth: 120,
          valueFormatter: (params) => params.value ?? "-",
        },
        { headerName: "Place of Service", field: "placeOfService", minWidth: 180 },
        { headerName: "Claims", field: "claimCount", minWidth: 100, filter: "agNumberColumnFilter" },
        { headerName: "Eligible", field: "eligibleClaimCount", minWidth: 110, filter: "agNumberColumnFilter" },
        { headerName: "Denied", field: "deniedClaimCount", minWidth: 100, filter: "agNumberColumnFilter" },
        { headerName: "Invalid", field: "invalidClaimCount", minWidth: 100, filter: "agNumberColumnFilter" },
        {
          headerName: "Avg Allowed",
          field: "averageAllowed",
          minWidth: 120,
          filter: "agNumberColumnFilter",
          valueFormatter: (params) => formatCurrency(params.value ?? Number.NaN),
        },
        {
          headerName: "Avg Billed",
          field: "averageBilled",
          minWidth: 120,
          filter: "agNumberColumnFilter",
          valueFormatter: (params) => formatCurrency(params.value ?? Number.NaN),
        },
        {
          headerName: "Avg Paid",
          field: "averagePaid",
          minWidth: 120,
          filter: "agNumberColumnFilter",
          valueFormatter: (params) => formatCurrency(params.value ?? Number.NaN),
        },
      ];
    },
    [store, store.groupingUsesPlan, goToClaimsForGroup]
  );

  const groupRowClassRules = useMemo<RowClassRules<PricingGroup>>(
    () => ({
      "bg-amber-50": (params) => needsGroupAttention(params.data),
      "bg-rose-50": (params) => (params.data?.eligibleClaimCount ?? 0) === 0,
    }),
    []
  );

  const claimColumnDefs = useMemo<(ColDef<ClaimRow> | ColGroupDef<ClaimRow>)[]>(
    () => [
      {
        headerName: "Actions",
        field: "id",
        minWidth: 140,
        editable: false,
        pinned: "left",
        cellRenderer: (params: { data?: ClaimRow }) => {
          if (!params.data) {
            return null;
          }
          return (
            <Group gap="xs">
              <Button size="xs" variant="light" onClick={() => openEditModal(params.data!)}>
                Edit
              </Button>
              <Button size="xs" color="red" variant="light" onClick={() => store.removeClaim(params.data!.id)}>
                Remove
              </Button>
            </Group>
          );
        },
      },
      {
        headerName: "Issue",
        minWidth: 160,
        editable: false,
        cellRenderer: (params: { data?: ClaimRow }) => {
          const claim = params.data;
          if (!claim) {
            return null;
          }
          const badges = [];
          if (!claim.isValid) {
            badges.push(
              <Badge key="invalid" color="red" variant="light">
                Invalid
              </Badge>
            );
          }
          if (isDeniedStatus(claim.claimStatus)) {
            badges.push(
              <Badge key="denied" color="yellow" variant="light">
                Denied
              </Badge>
            );
          }
          return <Group gap="xs">{badges.length > 0 ? badges : "-"}</Group>;
        },
      },
      {
        headerName: "Claim",
        children: [
          { headerName: "Claim ID", field: "claimId", minWidth: 160, editable: false },
          {
            headerName: "Status",
            field: "claimStatus",
            minWidth: 120,
            cellRenderer: (params: { value?: string }) => {
              if (!params.value) {
                return "";
              }
              if (isDeniedStatus(params.value)) {
                return <Badge color="red" variant="light">Denied</Badge>;
              }
              return params.value;
            },
          },
          { headerName: "Claim Type", field: "claimType", minWidth: 140 },
          { headerName: "Procedure", field: "procedureCode", minWidth: 130 },
          { headerName: "Place of Service", field: "placeOfService", minWidth: 180 },
        ],
      },
      {
        headerName: "Member",
        children: [
          { headerName: "Subscriber ID", field: "subscriberId", minWidth: 150 },
          { headerName: "Member Seq", field: "memberSequence", minWidth: 120 },
          { headerName: "Gender", field: "memberGender", minWidth: 100 },
        ],
      },
      {
        headerName: "Financials",
        children: [
          {
            headerName: "Billed",
            field: "billed",
            minWidth: 110,
            valueFormatter: (params) => formatCurrency(params.value ?? Number.NaN),
          },
          {
            headerName: "Allowed",
            field: "allowed",
            minWidth: 110,
            valueFormatter: (params) => formatCurrency(params.value ?? Number.NaN),
          },
          {
            headerName: "Paid",
            field: "paid",
            minWidth: 110,
            valueFormatter: (params) => formatCurrency(params.value ?? Number.NaN),
          },
          { headerName: "Payment Status", field: "paymentStatus", minWidth: 140 },
        ],
      },
      {
        headerName: "Dates",
        children: [
          { headerName: "Service Date", field: "serviceDate", minWidth: 130 },
          { headerName: "Received Date", field: "receivedDate", minWidth: 130 },
          { headerName: "Entry Date", field: "entryDate", minWidth: 130 },
          { headerName: "Processed Date", field: "processedDate", minWidth: 130 },
          { headerName: "Paid Date", field: "paidDate", minWidth: 130 },
          { headerName: "Payment Status Date", field: "paymentStatusDate", minWidth: 160 },
        ],
      },
      {
        headerName: "Customer",
        children: [
          { headerName: "Group Name", field: "groupName", minWidth: 180 },
          { headerName: "Group ID", field: "groupId", minWidth: 120 },
          { headerName: "Division Name", field: "divisionName", minWidth: 160 },
          { headerName: "Division ID", field: "divisionId", minWidth: 120 },
          { headerName: "Plan", field: "planName", minWidth: 160 },
          { headerName: "Plan ID", field: "planId", minWidth: 120 },
        ],
      },
      {
        headerName: "Provider",
        children: [
          { headerName: "Provider Name", field: "providerName", minWidth: 180 },
          { headerName: "Provider ID", field: "providerId", minWidth: 140 },
        ],
      },
    ],
    [store]
  );

  const issueRowClassRules = useMemo<RowClassRules<ClaimRow>>(
    () => ({
      "bg-rose-50": (params) => !params.data?.isValid,
      "bg-amber-50": (params) => isDeniedStatus(params.data?.claimStatus ?? ""),
    }),
    []
  );

  const onGroupValueChanged = (event: CellValueChangedEvent<PricingGroup>) => {
    if (!event.data || event.colDef.field !== "approved") {
      return;
    }
    store.setGroupApproval(event.data.id, Boolean(event.newValue));
  };

  const onGroupSelectionChanged = (event: { api: { getSelectedRows: () => PricingGroup[] } }) => {
    const selected = event.api.getSelectedRows();
    setSelectedGroupIds(selected.map((group) => group.id));
  };

  const onClaimValueChanged = (event: CellValueChangedEvent<ClaimRow>) => {
    if (!event.data || !event.colDef.field) {
      return;
    }
    store.updateClaimField(event.data.id, event.colDef.field as keyof ClaimRow, event.newValue);
  };

  return (
    <Stack gap="lg" className="px-4 py-6 md:px-8">
      {/* Summary card sets context and key metrics. */}
      <Card shadow="sm" padding="lg" radius="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2}>Review & approve pricing groups</Title>
            <Text size="sm" c="dimmed">
              Approve aggregated pricing groups instead of reviewing every claim row.
            </Text>
          </div>
          <Group>
            <StatBadge label="Total claims" value={store.claims.length} color="blue" />
            <StatBadge label="Eligible claims" value={store.eligibleCount} color="teal" />
            <StatBadge label="Denied claims" value={store.deniedCount} color="yellow" />
            <StatBadge label="Needs attention" value={store.attentionCount} color="orange" />
            <StatBadge label="Approved group claims" value={store.approvedGroupCount} color="green" />
          </Group>
        </Group>
        <Group mt="md">
          <Button variant="light" onClick={() => store.approveAllGroups()} disabled={!store.hasClaims}>
            Approve all eligible claims
          </Button>
          <Button variant="subtle" onClick={() => store.clearGroupApprovals()} disabled={!store.hasClaims}>
            Clear approvals
          </Button>
          <Button component={Link} to="/upload" variant="default">
            Upload new file
          </Button>
        </Group>
      </Card>

      {/* Tabs separate aggregated review from claim-level issues. */}
      <Tabs value={activeTab} onChange={(value) => value && setActiveTab(value)}>
        <Tabs.List>
          <Tabs.Tab value="groups">Pricing groups</Tabs.Tab>
          <Tabs.Tab value="edit-claims">Edit Claims</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="groups" pt="md">
          {/* Controls card keeps grouping and filters in one panel. */}
          <Card shadow="sm" padding="lg" radius="md">
            <Stack gap="md">
              <div>
                <Title order={3}>Pricing groups ready for approval</Title>
                <Text size="sm" c="dimmed">
                  Choose how claims are aggregated into pricing groups before approval.
                </Text>
              </div>
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  Grouping methodology
                </Text>
                <Group align="center" wrap="wrap">
                  <Select
                    data={store.groupingOptions}
                    value={store.groupingMethod}
                    onChange={(value) => value && store.setGroupingMethod(value as GroupingMethod)}
                    allowDeselect={false}
                    className="min-w-[240px]"
                  />
                  <Text size="xs" c="dimmed" className="max-w-md">
                    {store.groupingDescription}
                  </Text>
                </Group>
              </Stack>
              <Stack gap="sm">
                <Group justify="space-between" align="center" wrap="wrap">
                  <Text size="sm" fw={500}>
                    Filters
                  </Text>
                  <Button
                    size="xs"
                    variant="subtle"
                    disabled={!hasActiveGroupFilters}
                    onClick={clearGroupFilters}
                  >
                    Clear filters
                  </Button>
                </Group>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm" verticalSpacing="xs">
                  <MultiSelect
                    label="Customer"
                    placeholder="All customers"
                    data={groupFilterOptions.customers}
                    value={customerFilters}
                    onChange={setCustomerFilters}
                    searchable
                    clearable
                  />
                  {store.groupingUsesPlan && (
                    <MultiSelect
                      label="Plan"
                      placeholder="All plans"
                      data={groupFilterOptions.plans}
                      value={planFilters}
                      onChange={setPlanFilters}
                      searchable
                      clearable
                    />
                  )}
                  {store.groupingUsesProvider && (
                    <MultiSelect
                      label="Provider"
                      placeholder="All providers"
                      data={groupFilterOptions.providers}
                      value={providerFilters}
                      onChange={setProviderFilters}
                      searchable
                      clearable
                    />
                  )}
                  {store.groupingUsesProcedure && (
                    <MultiSelect
                      label="Procedure"
                      placeholder="All procedures"
                      data={groupFilterOptions.procedures}
                      value={procedureFilters}
                      onChange={setProcedureFilters}
                      searchable
                      clearable
                    />
                  )}
                  <MultiSelect
                    label="Billing class"
                    placeholder="All billing classes"
                    data={groupFilterOptions.billingClasses}
                    value={billingClassFilters}
                    onChange={setBillingClassFilters}
                    searchable
                    clearable
                  />
                  {store.groupingUsesServiceCode && (
                    <MultiSelect
                      label="Service code"
                      placeholder="All service codes"
                      data={groupFilterOptions.serviceCodes}
                      value={serviceCodeFilters}
                      onChange={setServiceCodeFilters}
                      searchable
                      clearable
                    />
                  )}
                  <TextInput
                    label="Keyword search"
                    placeholder="Search across group fields"
                    value={groupSearch}
                    onChange={(event) => setGroupSearch(event.currentTarget.value)}
                  />
                </SimpleGrid>
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    Status
                  </Text>
                  <SegmentedControl
                    value={groupFilter}
                    onChange={setGroupFilter}
                    data={[
                      { label: `All (${filteredGroupCounts.total})`, value: "all" },
                      { label: `Ready (${filteredGroupCounts.ready})`, value: "ready" },
                      { label: `Needs attention (${filteredGroupCounts.attention})`, value: "attention" },
                      { label: `Approved (${filteredGroupCounts.approved})`, value: "approved" },
                      { label: `Unapproved (${filteredGroupCounts.unapproved})`, value: "unapproved" },
                    ]}
                  />
                </Stack>
                <Group justify="space-between" align="center" wrap="wrap">
                  <Badge variant="light" color="gray">
                    Selected: {selectedGroupIds.length}
                  </Badge>
                  <Group gap="sm" wrap="wrap">
                    <Button
                      size="sm"
                      variant="light"
                      disabled={selectedGroupIds.length === 0}
                      onClick={() => selectedGroupIds.forEach((id) => store.setGroupApproval(id, true))}
                    >
                      Approve selected
                    </Button>
                    <Button
                      size="sm"
                      variant="subtle"
                      disabled={selectedGroupIds.length === 0}
                      onClick={() => selectedGroupIds.forEach((id) => store.setGroupApproval(id, false))}
                    >
                      Unapprove selected
                    </Button>
                  </Group>
                </Group>
              </Stack>
              {store.attentionCount > 0 && (
                <Alert color="orange">
                  {store.attentionCount} claims need attention. Resolve invalid or denied claims so their
                  pricing groups become eligible.
                </Alert>
              )}
            </Stack>
          </Card>

          {/* Fixed-height grid keeps layout stable while scrolling. */}
          <div className="ag-theme-quartz h-[520px] w-full">
            <AgGridReact
              rowData={filteredGroups}
              columnDefs={groupColumnDefs}
              getRowId={(params) => params.data.id}
              rowClassRules={groupRowClassRules}
              onCellValueChanged={onGroupValueChanged}
              onSelectionChanged={onGroupSelectionChanged}
              rowSelection="multiple"
              suppressRowClickSelection
              rowMultiSelectWithClick
              defaultColDef={{
                editable: false,
                sortable: true,
                filter: false,
                resizable: true,
              }}
            />
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="edit-claims" pt="md">
          {/* Issue filters and counts stay in a focused card. */}
          <Card shadow="sm" padding="lg" radius="md">
            <Stack gap="md">
              <div>
                <Title order={3}>Edit Claims</Title>
                <Text size="sm" c="dimmed">
                  Edit claim data and filter invalid or denied entries when needed.
                </Text>
              </div>
              <Group justify="space-between" align="center" wrap="wrap">
                <Group gap="sm" wrap="wrap">
                  <SegmentedControl
                    value={issueFilter}
                    onChange={setIssueFilter}
                    data={[
                      { label: `All (${store.claims.length})`, value: "all" },
                      { label: `Invalid (${store.invalidCount})`, value: "invalid" },
                      { label: `Denied (${store.deniedCount})`, value: "denied" },
                    ]}
                  />
                  <TextInput
                    placeholder="Search claim, member, provider..."
                    value={issueSearch}
                    onChange={(event) => setIssueSearch(event.currentTarget.value)}
                  />
                </Group>
                <Group gap="xs">
                  <Badge color="red" variant="light">
                    Invalid: {store.invalidCount}
                  </Badge>
                  <Badge color="yellow" variant="light">
                    Denied: {store.deniedCount}
                  </Badge>
                </Group>
              </Group>
            </Stack>
          </Card>

          {filteredClaims.length > 0 ? (
            <>
              {/* Fixed-height grid mirrors the groups panel for consistency. */}
              <div className="ag-theme-quartz h-[520px] w-full">
                <AgGridReact
                  rowData={filteredClaims}
                  columnDefs={claimColumnDefs}
                  getRowId={(params) => params.data.id}
                  rowClassRules={issueRowClassRules}
                  onCellValueChanged={onClaimValueChanged}
                  defaultColDef={{
                    editable: true,
                    sortable: true,
                    filter: true,
                    resizable: true,
                  }}
                />
              </div>
            </>
          ) : (
            <Alert
              color={store.claims.length > 0 ? "gray" : "teal"}
              title={store.claims.length > 0 ? "No claims match the filters" : "No claims loaded"}
            >
              {store.claims.length > 0
                ? "Adjust the filters to see the claims you need."
                : "Upload a CSV file to load claims for review."}
            </Alert>
          )}
        </Tabs.Panel>
      </Tabs>

      {/* Submission card anchors the final action at the end of the flow. */}
      <Card shadow="sm" padding="lg" radius="md">
        <Group justify="space-between" align="center">
          <div>
            <Title order={3}>Submit approved groups</Title>
            <Text size="sm" c="dimmed">
              Generates MRF JSON files using approved groups and eligible claims only.
            </Text>
          </div>
          <Button
            onClick={() => store.submitApprovedClaims()}
            loading={store.isSubmitting}
            disabled={store.approvedClaimCount === 0}
          >
            Generate MRFs
          </Button>
        </Group>
        {store.submitError && (
          <Alert color="red" mt="md">
            {store.submitError}
          </Alert>
        )}
        {store.submitResult.length > 0 && (
          <Alert color="teal" mt="md" title="MRF files generated">
            <Stack gap="xs">
              {store.submitResult.map((file) => (
                <Text key={`${file.customerId}-${file.fileName}`} size="sm">
                  {file.customerName} {"->"} {file.fileName}
                </Text>
              ))}
              <Button component={Link} to="/mrf" variant="light" size="xs">
                View MRF files
              </Button>
            </Stack>
          </Alert>
        )}
      </Card>

      <Modal
        opened={Boolean(editClaimId)}
        onClose={closeEditModal}
        title="Edit claim"
        centered
        size="lg"
        overlayProps={{ blur: 2 }}
      >
        <Stack gap="sm">
          {EDITABLE_FIELDS.map((fieldDef) => (
            <TextInput
              key={fieldDef.field}
              label={fieldDef.label}
              value={editForm[fieldDef.field] ?? ""}
              onChange={(event) => handleEditChange(fieldDef.field, event.currentTarget.value)}
              type={fieldDef.inputType === "number" ? "number" : fieldDef.inputType === "date" ? "date" : "text"}
            />
          ))}
          {currentEditClaim && (store.rowIssues[currentEditClaim.id] ?? []).length > 0 && (
            <Alert color="orange" title="Validation issues">
              <Stack gap={4}>
                {(store.rowIssues[currentEditClaim.id] ?? []).map((issue) => (
                  <Text key={`${issue.rowIndex}-${issue.field}`} size="sm">
                    {issue.field}: {issue.message}
                  </Text>
                ))}
              </Stack>
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeEditModal}>
              Cancel
            </Button>
            <Button onClick={saveEditModal}>Save changes</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export default observer(ReviewPage);
