import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { BatchNewPage } from "@/pages/BatchNewPage";
import { ItemDetailPage } from "@/pages/ItemDetailPage";
import { OutcomePage } from "@/pages/OutcomePage";
import { StartersPage } from "@/pages/StartersPage";
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
          <Route path="/outcome/:shortId" element={<OutcomePage />} />
          <Route path="/starters" element={<StartersPage />} />
          <Route path="/monitor" element={<MonitorPage />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
