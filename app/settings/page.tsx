import Sidebar from "@/components/dashboard/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import TopSearchBar from "@/components/TopSearchBar";
import SettingsPanel from "@/components/settings/SettingsPanel";
import "../tasks/tasks.css";
import "./settings.css";

export default function SettingsPage() {
  return (
    <AuthGuard>
      <div className="tasks-layout">
        <Sidebar />

        <main className="tasks-content">
          <div className="top-navbar">
            <TopSearchBar />
          </div>

          <SettingsPanel />
        </main>
      </div>
    </AuthGuard>
  );
}
