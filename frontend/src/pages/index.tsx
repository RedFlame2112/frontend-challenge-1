import { Card, Stack, Text, Title } from "@mantine/core";

// Landing card that points users to the upload flow.
export default function MainPage() {
  return (
    <div className="flex h-[70vh] items-center justify-center px-4">
      {/* Centered welcome card keeps onboarding focused. */}
      <Card shadow="sm" padding="lg" radius="md" className="w-full max-w-lg text-center">
        <Stack gap="xs">
          <Title order={2}>Welcome to the MRF Generator</Title>
          <Text size="sm" c="dimmed">
            Head to the upload page to review pricing groups and generate machine-readable files.
          </Text>
        </Stack>
      </Card>
    </div>
  );
}
