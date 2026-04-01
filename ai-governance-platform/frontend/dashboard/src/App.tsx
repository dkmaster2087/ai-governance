import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Shell } from './components/layout/Shell';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { PoliciesPage } from './pages/PoliciesPage';
import { ModelsPage } from './pages/ModelsPage';
import { SettingsPage } from './pages/SettingsPage';
import { CompliancePage } from './pages/CompliancePage';
import { ContentScannerPage } from './pages/ContentScannerPage';
import { TenantsPage } from './pages/TenantsPage';
import { ShadowAIPage } from './pages/ShadowAIPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, isAdmin } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/overview" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user } = useAuth();

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <RequireAuth>
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/login" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/audit-logs" element={<AuditLogsPage />} />
          <Route path="/policies" element={<PoliciesPage />} />
          <Route path="/compliance" element={<CompliancePage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/content-scanner" element={<ContentScannerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {/* Admin-only routes */}
          <Route path="/shadow-ai" element={<RequireAdmin><ShadowAIPage /></RequireAdmin>} />
          <Route path="/tenants" element={<RequireAdmin><TenantsPage /></RequireAdmin>} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </Shell>
    </RequireAuth>
  );
}
