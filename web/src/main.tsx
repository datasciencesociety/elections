import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import ElectionList from "./pages/election-list.js";
import ElectionResults from "./pages/election-results.js";
import CompareElections from "./pages/compare-elections.js";
import Turnout from "./pages/turnout.js";
import PartyList from "./pages/party-list.js";
import PartyProfile from "./pages/party-profile.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ElectionList />} />
        <Route path="/elections/:id" element={<ElectionResults />} />
        <Route path="/compare" element={<CompareElections />} />
        <Route path="/turnout/:id" element={<Turnout />} />
        <Route path="/parties" element={<PartyList />} />
        <Route path="/parties/:id" element={<PartyProfile />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
