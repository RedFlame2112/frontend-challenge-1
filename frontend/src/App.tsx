import { createTheme, MantineProvider } from "@mantine/core";
import { RouterProvider } from "react-router-dom";
import router from "./routes";

export default function App() {
  // Provide a single design-system entry point for all routes.
  return (
    <MantineProvider theme={theme}>
      <RouterProvider router={router} />
    </MantineProvider>
  );
}

// Shared theme tokens for Mantine components.
const theme = createTheme({
  // Seafoam palette drives primary accents and CTA states.
  primaryColor: "seafoam",
  primaryShade: 6,
  // Pair the geometric sans with a warm serif for hierarchy.
  fontFamily: `"Space Grotesk", "Segoe UI", system-ui, sans-serif`,
  headings: {
    // Display serif for headline contrast and brand tone.
    fontFamily: `"Fraunces", "Space Grotesk", "Segoe UI", system-ui, sans-serif`,
  },
  colors: {
    // Soft-to-deep ramp used for hover, active, and contrast states.
    seafoam: [
      "#e6f8f4",
      "#c7efe7",
      "#9be2d5",
      "#6fd3c3",
      "#43c2af",
      "#1da790",
      "#158374",
      "#106558",
      "#0b4b41",
      "#06342c",
    ],
  },
});
