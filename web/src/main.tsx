import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router";
import Layout from "./components/layout.js";
import DistrictPieMap from "./pages/district-pie-map.js";
import RiskMap from "./pages/risk-map.js";
import CompareElections from "./pages/compare-elections.js";
import PartyList from "./pages/party-list.js";
import PartyProfile from "./pages/party-profile.js";
import ElectionResults from "./pages/election-results.js";
import Turnout from "./pages/turnout.js";
import ElectionMap from "./pages/election-map.js";
import SectionsTable from "./pages/sections-table.js";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* Main views */}
          <Route path="/:electionId/results" element={<DistrictPieMap />} />
          <Route path="/:electionId/sections" element={<RiskMap />} />
          <Route path="/:electionId/table" element={<SectionsTable />} />
          <Route path="/compare" element={<CompareElections />} />
          <Route path="/parties" element={<PartyList />} />
          <Route path="/parties/:id" element={<PartyProfile />} />

          {/* Keep old pages accessible for now */}
          <Route path="/elections/:id/details" element={<ElectionResults />} />
          <Route path="/turnout/:id" element={<Turnout />} />
          <Route path="/map/:electionId" element={<ElectionMap />} />

          {/* Redirect old risk URL to combined sections page */}
          <Route path="/:electionId/risk" element={<RedirectToSections />} />

          {/* Default: Layout handles redirect to latest election */}
          <Route path="/" element={<></>} />
        </Route>

        {/* Old URL redirects (outside layout since they just redirect) */}
        <Route path="/district-map/:electionId" element={<RedirectToResults />} />
        <Route path="/risk-map/:electionId" element={<RedirectToSections />} />
        <Route path="/elections/:id" element={<RedirectElection />} />
        <Route path="/elections/:id/anomalies" element={<RedirectAnomalies />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
