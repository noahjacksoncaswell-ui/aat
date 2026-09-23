import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Sites from "./pages/Sites";
import Missions from "./pages/Missions";
import MissionDetail from "./pages/MissionDetail";
import Vehicles from "./pages/Vehicles";
import Faa from "./pages/Faa";
import Documents from "./pages/Documents";
import Admin from "./pages/Admin";
import RangeOps from "./pages/RangeOps";
import TrajectorySim from "./pages/TrajectorySim";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">
        Loading AAT LOD Platform...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/sites" element={<Sites />} />
        <Route path="/sites/:siteId" element={<Sites />} />
        <Route path="/missions" element={<Missions />} />
        <Route path="/missions/:missionId" element={<MissionDetail />} />
        <Route path="/vehicles" element={<Vehicles />} />
        <Route path="/vehicles/:vehicleId" element={<Vehicles />} />
        <Route path="/faa" element={<Faa />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/trajectory-sim" element={<TrajectorySim />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      {/* v5.1 Section 3 - outside the Layout-wrapped group deliberately: the
          Range Ops Display page collapses the standard sidebar/header chrome
          itself, which Layout's fixed <aside> cannot express as a variant. */}
      <Route
        path="/range-ops"
        element={
          <RequireAuth>
            <RangeOps />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
