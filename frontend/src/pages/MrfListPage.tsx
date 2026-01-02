import { useEffect } from "react";
import { observer } from "mobx-react-lite";
import { Navigate, useParams } from "react-router-dom";
import {
  Accordion,
  Alert,
  Badge,
  Card,
  Group,
  Stack,
  Anchor,
  Text,
  Title,
} from "@mantine/core";
import { getMrfDownloadUrl } from "~/services/api";
import { useAppStore } from "~/stores/appStore";
import { formatDateTime } from "~/utils/formatters";

function MrfListPage() {
  const store = useAppStore();
  const { customerId } = useParams();

  useEffect(() => {
    // Fetch the list whenever auth or customer selection changes.
    if (!store.isAuthenticated) {
      return;
    }
    void store.fetchMrfs(customerId);
  }, [customerId, store, store.isAuthenticated]);

  if (!store.isAuthenticated) {
    return <Navigate to="/upload" replace />;
  }

  return (
    <Stack gap="lg" className="px-4 py-6 md:px-8">
      {/* Header card introduces the list context. */}
      <Card shadow="sm" padding="lg" radius="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2}>Machine-readable files</Title>
            <Text size="sm" c="dimmed">
              Public list of MRF files by customer group.
            </Text>
          </div>
          {customerId && <Badge color="teal">Customer: {customerId}</Badge>}
        </Group>
      </Card>

      {store.mrfError && <Alert color="red">{store.mrfError}</Alert>}

      {store.mrfLoading && <Alert color="blue">Loading MRF files...</Alert>}

      {store.mrfCustomers.length === 0 && !store.mrfLoading && (
        <Alert color="gray">No MRF files found yet.</Alert>
      )}

      {/* Accordion keeps each customer's file list compact and scannable. */}
      <Accordion variant="contained" chevronPosition="right" radius="md">
        {store.mrfCustomers.map((customer) => (
          <Accordion.Item key={customer.id} value={customer.id}>
            <Accordion.Control>
              <Group justify="space-between" w="100%">
                <div>
                  <Text fw={600}>{customer.name}</Text>
                  <Text size="xs" c="dimmed">
                    {customer.id}
                  </Text>
                </div>
                <Badge color="blue" variant="light">
                  {customer.files.length} file{customer.files.length === 1 ? "" : "s"}
                </Badge>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                {customer.files.map((file) => (
                  <Group key={file.fileName} justify="space-between">
                    <div>
                      <Text size="sm" fw={500}>
                        {file.fileName}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Created {formatDateTime(file.createdAt)} - {file.claimCount} claims
                      </Text>
                    </div>
                    <Anchor
                      href={getMrfDownloadUrl(customer.id, file.fileName)}
                      target="_blank"
                      rel="noreferrer"
                      c="teal"
                      fw={600}
                      underline="hover"
                      size="sm"
                    >
                      Download
                    </Anchor>
                  </Group>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}

export default observer(MrfListPage);
