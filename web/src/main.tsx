import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import ElectionList from "./pages/election-list.js";
import ElectionResults from "./pages/election-results.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ElectionList />} />
        <Route path="/elections/:id" element={<ElectionResults />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
