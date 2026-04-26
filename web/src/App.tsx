import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { BatchNewPage } from "@/pages/BatchNewPage";
import { ItemDetailPage } from "@/pages/ItemDetailPage";
import { ItemPlotPage } from "@/pages/ItemPlotPage";
import { OutcomePage } from "@/pages/OutcomePage";
import { StartersPage } from "@/pages/StartersPage";
import { StarterDetailPage } from "@/pages/StarterDetailPage";
import { StationsPage } from "@/pages/StationsPage";
import { StationDetailPage } from "@/pages/StationDetailPage";
import { SessionsPage } from "@/pages/SessionsPage";
import MonitorPage from "@/pages/MonitorPage";
import { Toaster } from "@/components/ui/sonner";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/batch/new" element={<BatchNewPage />} />
          <Route path="/item/:shortId" element={<ItemDetailPage />} />
          <Route path="/item/:shortId/plot" element={<ItemPlotPage />} />
          <Route path="/outcome/:shortId" element={<OutcomePage />} />
          <Route path="/starters" element={<StartersPage />} />
          <Route path="/starters/:id" element={<StarterDetailPage />} />
          <Route path="/stations" element={<StationsPage />} />
          <Route path="/stations/:id" element={<StationDetailPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/monitor" element={<MonitorPage />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
