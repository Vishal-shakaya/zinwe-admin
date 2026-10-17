import { lazy, Suspense, useCallback, useEffect, useState, type ReactElement } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { getMe, type AdminMe } from "./lib/api";
import { clearToken, getToken } from "./lib/session";
import { Layout } from "./components/Layout";
import { PageErrorBoundary } from "./components/PageErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { SubscribersPage } from "./pages/SubscribersPage";
import { SupportPage } from "./pages/SupportPage";
import { FormsPage } from "./pages/FormsPage";
import { ReleasesPage } from "./pages/ReleasesPage";
import { AnnouncementsPage } from "./pages/AnnouncementsPage";
import { SubscriptionsPage } from "./pages/SubscriptionsPage";
import { BlogPage } from "./pages/BlogPage";
import { BlogEditorPage } from "./pages/BlogEditorPage";
import { BlogSubscribersPage } from "./pages/BlogSubscribersPage";

// Documentation tab: local dev only. `import.meta.env.DEV` is false in `vite build`, so production bundles drop
// this import (and the docs are served only by the dev server, see vite.config.ts).
const DocsPage = import.meta.env.DEV ? lazy(() => import("./pages/DocsPage")) : null;

type AuthState =
  | { kind: "loading" }
  | { kind: "out" }
  | { kind: "in"; me: AdminMe };

export function App(): ReactElement {
  const [auth, setAuth] = useState<AuthState>({ kind: "loading" });
  const { pathname } = useLocation();

  const check = useCallback(async () => {
    if (!getToken()) {
      setAuth({ kind: "out" });
      return;
    }
    try {
      const me = await getMe();
      setAuth(me.is_staff ? { kind: "in", me } : { kind: "out" });
    } catch {
      clearToken();
      setAuth({ kind: "out" });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const signOut = () => {
    clearToken();
    setAuth({ kind: "out" });
  };

  if (auth.kind === "loading") {
    return <div className="boot">Loading…</div>;
  }

  if (auth.kind === "out") {
    return <LoginPage onSignedIn={check} />;
  }

  return (
    <ToastProvider>
      <Layout me={auth.me} onSignOut={signOut}>
        <PageErrorBoundary resetKey={pathname}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            {/* Plan activation now lives in Subscribers (Waiting filter); keep old links working. */}
            <Route path="/activations" element={<Navigate to="/subscribers?status=waiting" replace />} />
            <Route path="/subscribers" element={<SubscribersPage />} />
            <Route path="/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/feedback" element={<FeedbackPage />} />
            <Route path="/support" element={<SupportPage />} />
            <Route path="/forms" element={<FormsPage />} />
            <Route path="/releases" element={<ReleasesPage />} />
            <Route path="/announcements" element={<AnnouncementsPage />} />
            <Route path="/blog" element={<BlogPage />} />
            <Route path="/blog/subscribers" element={<BlogSubscribersPage />} />
            <Route path="/blog/:id" element={<BlogEditorPage />} />
            {DocsPage ? (
              <Route
                path="/docs/:slug?"
                element={
                  <Suspense fallback={<p className="muted">Loading…</p>}>
                    <DocsPage />
                  </Suspense>
                }
              />
            ) : null}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </PageErrorBoundary>
      </Layout>
    </ToastProvider>
  );
}
