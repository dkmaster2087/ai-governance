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
import { ChatPage } from './pages/ChatPage';
import { UsersPage } from './pages/UsersPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, isAdmin } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/chat" replace />;
  return <>{children}</>;
}

function RequirePlatformAdmin({ children }: { children: React.ReactNode }) {
  const { user, isPlatformAdmin } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!isPlatformAdmin) return <Navigate to="/overview" replace />;
  return <>{children}</>;
}

function RequireAuditAccess({ children }: { children: React.ReactNode }) {
  const { user, canViewAudit } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!canViewAudit) return <Navigate to="/chat" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, isChatOnly } = useAuth();

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Chat-only users get a minimal shell
  if (isChatOnly) {
    return (
      <RequireAuth>
        <Shell>
          <Routes>
            <Route path="/chat" element={<ChatPage />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </Shell>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/login" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/chat" element={<ChatPage />} />
          {/* Audit access: admin + auditor */}
          <Route path="/audit-logs" element={<RequireAuditAccess><AuditLogsPage /></RequireAuditAccess>} />
          {/* Admin-only tenant routes */}
          <Route path="/policies" element={<RequireAdmin><PoliciesPage /></RequireAdmin>} />
          <Route path="/compliance" element={<RequireAdmin><CompliancePage /></RequireAdmin>} />
          <Route path="/models" element={<RequireAdmin><ModelsPage /></RequireAdmin>} />
          <Route path="/content-scanner" element={<RequireAdmin><ContentScannerPage /></RequireAdmin>} />
          <Route path="/settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
          <Route path="/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
          {/* Platform admin only */}
          <Route path="/shadow-ai" element={<RequireAdmin><ShadowAIPage /></RequireAdmin>} />
          <Route path="/tenants" element={<RequirePlatformAdmin><TenantsPage /></RequirePlatformAdmin>} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </Shell>
    </RequireAuth>
  );
}
