import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DirectoriesPage } from "./pages/dispatcher/DirectoriesPage";
import { DocumentsPage } from "./pages/dispatcher/DocumentsPage";
import { FuelPage } from "./pages/dispatcher/FuelPage";
import { MaintenancePage } from "./pages/dispatcher/MaintenancePage";
import { TripsPage } from "./pages/dispatcher/TripsPage";
import { MyTripsPage } from "./pages/driver/MyTripsPage";

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-6 text-slate-500">Загрузка…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "DRIVER") return <Navigate to="/driver/trips" replace />;
  return <Navigate to="/dispatcher/fuel" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<HomeRedirect />} />

      <Route
        path="/dispatcher"
        element={
          <ProtectedRoute roles={["ADMIN", "DISPATCHER"]}>
            <Layout
              title="Диспетчер"
              links={[
                { to: "/dispatcher/fuel", label: "Топливо" },
                { to: "/dispatcher/maintenance", label: "ТО и ремонт" },
                { to: "/dispatcher/trips", label: "Рейсы" },
                { to: "/dispatcher/documents", label: "Документы" },
                { to: "/dispatcher/directories", label: "Справочники" },
              ]}
            />
          </ProtectedRoute>
        }
      >
        <Route path="fuel" element={<FuelPage />} />
        <Route path="maintenance" element={<MaintenancePage />} />
        <Route path="trips" element={<TripsPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="directories" element={<DirectoriesPage />} />
      </Route>

      <Route
        path="/driver"
        element={
          <ProtectedRoute roles={["DRIVER"]}>
            <Layout title="Водитель" links={[{ to: "/driver/trips", label: "Мои рейсы" }]} />
          </ProtectedRoute>
        }
      >
        <Route path="trips" element={<MyTripsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
