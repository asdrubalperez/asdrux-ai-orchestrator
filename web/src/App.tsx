import { Loader2 } from "lucide-react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LoginView } from "./auth/LoginView";
import { RegisterView } from "./auth/RegisterView";
import { VerifyEmailView } from "./auth/VerifyEmailView";
import { ForgotPasswordView } from "./auth/ForgotPasswordView";
import { ResetPasswordView } from "./auth/ResetPasswordView";
import { useCurrentUser } from "./auth/useCurrentUser";
import { ProjectGate } from "./projects/ProjectGate";
import { ProjectsListPage } from "./projects/ProjectsListPage";
import { NewProjectPage } from "./projects/NewProjectPage";
import { RepositorySettingsPage } from "./projects/RepositorySettingsPage";
import { ProjectAgentConfigPage } from "./projects/ProjectAgentConfigPage";
import { ProjectShell } from "./projects/ProjectShell";
import { AgentConfigPage } from "./agentConfig/AgentConfigPage";
import { AdminUsersPage } from "./admin/AdminUsersPage";
import { CasesList } from "./intake/CasesList";
import { DisparoScreen } from "./intake/DisparoScreen";
import { RunDetailPage } from "./runs/RunDetailPage";

// FEATURE-041: las rutas públicas (registro, verificación, recuperación, activación) se resuelven
// ANTES de requerir sesión -- una persona sin cuenta o sin loguearse todavía necesita llegar a
// ellas. `/settings/agents` (módulo de cuenta) es la única ruta protegida exenta del gate de
// onboarding (Regla 5.2) -- ver requireSession/isOnboardingExemptPath en el backend, mismo
// criterio replicado acá.
const PUBLIC_ROUTES = (
  <>
    <Route path="/register" element={<RegisterView />} />
    <Route path="/verify-email" element={<VerifyEmailView />} />
    <Route path="/forgot-password" element={<ForgotPasswordView />} />
    <Route path="/reset-password" element={<ResetPasswordView mode="reset" />} />
    <Route path="/activate-account" element={<ResetPasswordView mode="activate" />} />
  </>
);

export function App() {
  const auth = useCurrentUser();

  if (auth.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-700">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Validando sesión...
      </main>
    );
  }

  if (!auth.user) {
    return (
      <BrowserRouter>
        <Routes>
          {PUBLIC_ROUTES}
          <Route path="*" element={<LoginView onLogin={auth.refresh} />} />
        </Routes>
      </BrowserRouter>
    );
  }

  const user = auth.user;
  const onboardingPending = !user.displayName;

  return (
    <BrowserRouter>
      <Routes>
        {PUBLIC_ROUTES}
        {/* Regla 5.2: cuenta activa sin nombre visible solo accede al módulo de cuenta. */}
        <Route path="/settings/agents" element={<AgentConfigPage />} />
        {onboardingPending ? (
          <Route path="*" element={<Navigate to="/settings/agents" replace />} />
        ) : (
          <>
            <Route path="/" element={<ProjectGate />} />
            <Route path="/projects" element={<ProjectsListPage />} />
            <Route path="/projects/new" element={<NewProjectPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/projects/:projectId" element={<ProjectShell user={user} onLogout={auth.logout} />}>
              <Route index element={<Navigate to="cases" replace />} />
              <Route path="cases" element={<CasesList />} />
              <Route path="cases/new" element={<DisparoScreen />} />
              <Route path="cases/:caseId" element={<RunDetailPage />} />
              <Route path="settings/repository" element={<RepositorySettingsPage />} />
              <Route path="settings/agent-config" element={<ProjectAgentConfigPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
