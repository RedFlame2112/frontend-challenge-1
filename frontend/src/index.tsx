import { createRoot } from "react-dom/client";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import App from "./App";
import "./index.css";
import "@mantine/core/styles.css";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

// Register ag-grid modules once at startup.
ModuleRegistry.registerModules([AllCommunityModule]);

createRoot(document.getElementById("root")).render(<App />);
