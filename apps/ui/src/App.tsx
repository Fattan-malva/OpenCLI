import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { RightPanel } from './components/RightPanel';
import { Modal } from './components/Modal';
import { Toasts } from './components/Toasts';
import { WorkflowPage } from './pages/WorkflowPage';
import { AgentsPage } from './pages/AgentsPage';
import { ModelsPage } from './pages/ModelsPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
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
          <AgentsPage active={page === 'agents'} />
          <ModelsPage active={page === 'models'} />
          <WorkspacesPage active={page === 'workspaces'} />
        </main>
        <RightPanel />
      </div>
      <Modal />
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}