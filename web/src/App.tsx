import { Loader2 } from "lucide-react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LoginView } from "./auth/LoginView";
import { useCurrentUser } from "./auth/useCurrentUser";
import { ProjectGate } from "./projects/ProjectGate";
import { ProjectsListPage } from "./projects/ProjectsListPage";
import { NewProjectPage } from "./projects/NewProjectPage";
import { RepositorySettingsPage } from "./projects/RepositorySettingsPage";
import { ProjectShell } from "./projects/ProjectShell";
import { AgentConfigPage } from "./agentConfig/AgentConfigPage";
import { CasesList } from "./intake/CasesList";
import { DisparoScreen } from "./intake/DisparoScreen";
import { RunDetailPage } from "./runs/RunDetailPage";

// FEATURE-042, sección C.2: rutas propuestas. `/auth/github/start|callback` no son rutas de este
// router -- viven en el backend (src/server/app.ts), el frontend solo las navega/recibe de vuelta
// vía returnPath (sección C.6).
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
    return <LoginView onLogin={auth.refresh} />;
  }

  const user = auth.user;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProjectGate />} />
        <Route path="/projects" element={<ProjectsListPage />} />
        <Route path="/projects/new" element={<NewProjectPage />} />
        {/* FEATURE-025-Parte-1: configuración de usuario, no de proyecto -- fuera de ProjectShell. */}
        <Route path="/settings/agents" element={<AgentConfigPage />} />
        <Route path="/projects/:projectId" element={<ProjectShell user={user} onLogout={auth.logout} />}>
          <Route index element={<Navigate to="cases" replace />} />
          <Route path="cases" element={<CasesList />} />
          <Route path="cases/new" element={<DisparoScreen />} />
          <Route path="cases/:caseId" element={<RunDetailPage />} />
          <Route path="settings/repository" element={<RepositorySettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
