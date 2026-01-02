import { AppShell, Button, Group, Text } from "@mantine/core";
import { observer } from "mobx-react-lite";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAppStore } from "~/stores/appStore";

// Top-level navigation shown in the app shell header.
const navItems = [
  { label: "Upload", path: "/upload" },
  { label: "Review Groups", path: "/review" },
  { label: "MRF Files", path: "/mrf" },
];

function BasicLayout() {
  const store = useAppStore();
  const location = useLocation();

  // AppShell frames all pages with a consistent header.
  return (
    <AppShell
      header={{ height: 64 }}
      padding="md"
      className="min-h-screen bg-transparent"
    >
      <AppShell.Header className="border-b border-emerald-100/70 bg-white/70 backdrop-blur">
        {/* Translucent header keeps the background texture visible. */}
        <div className="flex h-full items-center justify-between px-6">
          <Group gap="sm">
            {/* Monogram badge reinforces brand in compact space. */}
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-900 text-white">
              CH
            </div>
            <div>
              <Text fw={700}>Clearest Health</Text>
              <Text size="xs" c="dimmed">
                MRF Generator
              </Text>
            </div>
          </Group>
          <Group gap="xs">
            {/* Primary navigation highlights the active route. */}
            {navItems.map((item) => {
              const isActive = location.pathname.startsWith(item.path);
              return (
                <Button
                  key={item.path}
                  component={Link}
                  to={item.path}
                  variant={isActive ? "filled" : "subtle"}
                  color="teal"
                  size="sm"
                >
                  {item.label}
                </Button>
              );
            })}
            {store.isAuthenticated && (
              <Button
                variant="light"
                size="sm"
                onClick={() => {
                  store.logout();
                  window.location.assign("/upload");
                }}
              >
                Sign out
              </Button>
            )}
          </Group>
        </div>
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

export default observer(BasicLayout);
