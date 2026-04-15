import "./instrument.js";
import "./index.css";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trackPageView, startEngagementHeartbeat } from "./lib/analytics.js";
import Layout from "./components/layout.js";
import DistrictPieMap from "./pages/district-pie-map.js";
import AnomalyMap from "./pages/anomaly-map/index.js";
import SectionsTable from "./pages/sections-table.js";
import Persistence from "./pages/persistence.js";
import SectionDetail from "./pages/section-detail.js";
import MissingCoordinates from "./pages/missing-coordinates.js";
import Landing from "./pages/landing.js";
import { BrowseAbroad, BrowseDistrict } from "./pages/browse.js";
import ExplorerHelp from "./pages/explorer-help.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Track page views on route change
function AnalyticsTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView(location.pathname, location.search);
  }, [location.pathname, location.search]);
  return null;
}

// Redirect helpers for old URLs
function RedirectToResults() {
  const { electionId } = useParams();
  return <Navigate to={`/${electionId}/results`} replace />;
}
function RedirectToSections() {
  const { electionId } = useParams();
  return <Navigate to={`/${electionId}/sections`} replace />;
}
function RedirectElection() {
  const { id } = useParams();
  return <Navigate to={`/${id}/results`} replace />;
}
function RedirectAnomalies() {
  const { id } = useParams();
  return <Navigate to={`/${id}/sections`} replace />;
}

startEngagementHeartbeat();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AnalyticsTracker />
        <Routes>
          <Route element={<Layout />}>
            {/* Landing */}
            <Route path="/" element={<Landing />} />

            {/* Browse drill-down */}
            <Route path="/browse/district/:id" element={<BrowseDistrict />} />
            <Route path="/browse/abroad" element={<BrowseAbroad />} />

            {/* Main views */}
            <Route path="/:electionId/results" element={<DistrictPieMap />} />
            <Route path="/:electionId/sections" element={<AnomalyMap />} />
            <Route path="/:electionId/table" element={<SectionsTable />} />
            <Route path="/persistence" element={<Persistence />} />
            <Route path="/section/:sectionCode" element={<SectionDetail />} />
            <Route path="/help/coordinates" element={<MissingCoordinates />} />
            <Route path="/help/explorer" element={<ExplorerHelp />} />
            {/* Redirect old risk URL to combined sections page */}
            <Route path="/:electionId/risk" element={<RedirectToSections />} />
          </Route>

          {/* Old URL redirects (outside layout since they just redirect) */}
          <Route path="/district-map/:electionId" element={<RedirectToResults />} />
          <Route path="/risk-map/:electionId" element={<RedirectToSections />} />
          <Route path="/elections/:id" element={<RedirectElection />} />
          <Route path="/elections/:id/anomalies" element={<RedirectAnomalies />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
