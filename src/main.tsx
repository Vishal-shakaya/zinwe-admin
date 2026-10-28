import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
// Shared CSS first, so page stylesheets (imported by the pages) win at equal specificity.
import "./styles/base.css";
import "./styles.css";
import { App } from "./App";

// A data router (not <BrowserRouter>), so pages can use useBlocker to guard unsaved work on in-app
// navigation (the blog editor). App keeps its own <Routes> under this one catch-all route.
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
