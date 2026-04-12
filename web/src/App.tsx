import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { Toaster } from "@/components/ui/sonner";

function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">Coming in the next step.</p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/batch/new" element={<Placeholder title="New Batch" />} />
          <Route path="/item/:shortId" element={<Placeholder title="Item Detail" />} />
          <Route path="/outcome/:shortId" element={<Placeholder title="Outcome" />} />
          <Route path="/starters" element={<Placeholder title="Starters" />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
