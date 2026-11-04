import Sidebar from "@/components/dashboard/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import TopSearchBar from "@/components/TopSearchBar";
import LoginManager from "@/components/logins/LoginManager";
import "../tasks/tasks.css";
import "./logins.css";

export default function LoginsPage() {
  return (
    <AuthGuard roles={["ADMIN"]}>
      <div className="tasks-layout">
        <Sidebar />

        <main className="tasks-content">
          <div className="top-navbar">
            <TopSearchBar />
          </div>

          <LoginManager />
        </main>
      </div>
    </AuthGuard>
  );
}
