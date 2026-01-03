import { useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import {
  Alert,
  Badge,
  Button,
  Card,
  FileButton,
  Group,
  List,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Link } from "react-router-dom";
import { useAppStore } from "~/stores/appStore";
import StatBadge from "~/components/StatBadge";

function UploadPage() {
  const store = useAppStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Show a small slice of issues to keep the alert compact.
  const validationPreview = useMemo(() => store.validationIssues.slice(0, 5), [store.validationIssues]);

  if (!store.isAuthenticated) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        {/* Centered sign-in card keeps focus on authentication. */}
        <Card shadow="sm" padding="lg" radius="md" className="w-full max-w-md">
          <Stack gap="md">
            <div>
              <Title order={2}>Sign in to review pricing groups</Title>
              <Text size="sm" c="dimmed">
                Use demo / demo for the dummy authentication.
              </Text>
            </div>
            <TextInput
              label="Username"
              placeholder="demo"
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
            />
            <PasswordInput
              label="Password"
              placeholder="demo"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
            {store.authError && <Alert color="red">{store.authError}</Alert>}
            <Button onClick={() => store.login(username.trim(), password)}>Sign in</Button>
          </Stack>
        </Card>
      </div>
    );
  }

  return (
    <Stack gap="lg" className="px-4 py-6 md:px-8">
      {/* Primary upload card with parsing feedback. */}
      <Card shadow="sm" padding="lg" radius="md">
        <Stack gap="md">
          <div>
            <Title order={2}>Upload claims CSV</Title>
            <Text size="sm" c="dimmed">
              Parse, validate, and prepare claims for pricing group approval before MRF generation.
            </Text>
          </div>
          <Group>
            <FileButton onChange={(file) => file && store.parseCsv(file)} accept=".csv">
              {(props) => (
                <Button {...props} loading={store.isParsing}>
                  Select CSV file
                </Button>
              )}
            </FileButton>
            {store.fileName && <Badge color="teal">{store.fileName}</Badge>}
          </Group>
          {store.parseError && (
            <Alert color="red" title="Parsing error">
              {store.parseError}
            </Alert>
          )}
          {store.validationIssues.length > 0 && (
            <Alert color="orange" title="Validation issues">
              <Text size="sm">First few issues:</Text>
              <List size="sm" mt="xs">
                {validationPreview.map((issue) => (
                  <List.Item key={`${issue.rowIndex}-${issue.field}`}>
                    Row {issue.rowIndex}: {issue.field} - {issue.message}
                  </List.Item>
                ))}
              </List>
              {store.validationIssues.length > validationPreview.length && (
                <Text size="xs" mt="xs">
                  {store.validationIssues.length - validationPreview.length} more issues not shown.
                </Text>
              )}
            </Alert>
          )}
        </Stack>
      </Card>

      {/* Summary card highlights totals before moving to review. */}
      <Card shadow="sm" padding="lg" radius="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Title order={3}>Claims summary</Title>
            <Text size="sm" c="dimmed">
              Review totals before approving pricing groups.
            </Text>
          </Stack>
          <Group>
            <StatBadge label="Total claims" value={store.claims.length} color="blue" />
            <StatBadge label="Eligible claims" value={store.eligibleCount} color="teal" />
            <StatBadge label="Denied claims" value={store.deniedCount} color="yellow" />
            <StatBadge label="Approved group claims" value={store.approvedGroupCount} color="green" />
            <StatBadge
              label="Invalid claims"
              value={store.invalidCount}
              color={store.invalidCount > 0 ? "orange" : "teal"}
            />
          </Group>
        </Group>
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            {store.hasClaims
              ? "Proceed to approve pricing groups and resolve invalid claims."
              : "Upload a CSV file to populate claims."}
          </Text>
          <Button component={Link} to="/review" disabled={!store.hasClaims}>
            Review pricing groups
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}

export default observer(UploadPage);
