import { Card, Stack, Text, Title } from "@mantine/core";

// Simple not-found panel for unknown routes.
export default function NotFoundPage() {
  return (
    <div className="flex h-[70vh] items-center justify-center px-4">
      {/* Calm, minimal error card reduces friction. */}
      <Card shadow="sm" padding="lg" radius="md" className="w-full max-w-sm text-center">
        <Stack gap={4}>
          <Title order={2}>404</Title>
          <Text size="sm" c="dimmed">
            Page not found
          </Text>
        </Stack>
      </Card>
    </div>
  );
}
