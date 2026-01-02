import { createBrowserRouter, Navigate } from "react-router-dom";
import BasicLayout from "./layout/BasicLayout";
import NotFoundPage from "./pages/error/NotFound";
import MrfListPage from "./pages/MrfListPage";
import ReviewPage from "./pages/ReviewPage";
import UploadPage from "./pages/UploadPage";

// Route tree shared by the app shell and pages.
const router = createBrowserRouter([
  {
    element: <BasicLayout />,
    children: [
      {
        path: "/",
        element: <Navigate to="/upload" replace />,
      },
      {
        path: "/upload",
        element: <UploadPage />,
      },
      {
        path: "/review",
        element: <ReviewPage />,
      },
      {
        path: "/mrf",
        element: <MrfListPage />,
      },
      {
        path: "/mrf/:customerId",
        element: <MrfListPage />,
      },
    ],
    errorElement: <NotFoundPage />,
  },
]);

export default router;
