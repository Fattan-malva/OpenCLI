import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { RightPanel } from './components/RightPanel';
import { Modal } from './components/Modal';
import { Toasts } from './components/Toasts';
import { WorkflowPage } from './pages/WorkflowPage';
import { AdaptersPage } from './pages/AdaptersPage';
import { ModelsPage } from './pages/ModelsPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { SettingsPage } from './pages/SettingsPage';
import { AuthPage } from './pages/AuthPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { StoreProvider, useStore } from './store';

function Shell() {
  const { page } = useStore();
  return (
    <div className="h-screen flex flex-col text-sm antialiased selection:bg-app-primary selection:text-white">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col bg-app-bg min-w-0 relative">
          <WorkflowPage active={page === 'workflow'} />
          <AdaptersPage active={page === 'agents'} />
          <ModelsPage active={page === 'models'} />
          <WorkspacesPage active={page === 'workspaces'} />
          <SettingsPage active={page === 'settings'} />
        </main>
        <RightPanel />
      </div>
      <Modal />
      <Toasts />
    </div>
  );
}

function Gate() {
  const { screen } = useStore();
  if (screen === 'boot') {
    return (
      <div className="h-screen flex items-center justify-center bg-app-bg">
        <div className="flex items-center space-x-2 text-app-text">
          <IconBoot />
          <span>Loading...</span>
        </div>
      </div>
    );
  }
  if (screen === 'auth') {
    return (
      <>
        <AuthPage />
        <Toasts />
      </>
    );
  }
  if (screen === 'projects') {
    return (
      <>
        <ProjectsPage />
        <Modal />
        <Toasts />
      </>
    );
  }
  return <Shell />;
}

function IconBoot() {
  return (
    <svg className="w-5 h-5 animate-spin text-app-primary" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
    </svg>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Gate />
    </StoreProvider>
  );
}