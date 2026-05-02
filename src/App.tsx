import { Routes, Route, Navigate } from "react-router";
import { AppLayout } from "./components/app-layout";
import { LoginPage } from "./routes/login";
import { DashboardPage } from "./routes/dashboard";
import { LeadsPage } from "./routes/leads";
import { AutomacoesPage } from "./routes/automacoes";
import { AdsPage } from "./routes/ads";
import { RequireAuth } from "./components/require-auth";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/automacoes" element={<AutomacoesPage />} />
        <Route path="/ads" element={<AdsPage />} />
        <Route index element={<Navigate to="/dashboard" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
