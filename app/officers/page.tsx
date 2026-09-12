import Sidebar from "@/components/dashboard/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import TopSearchBar from "@/components/TopSearchBar";
import DesignationCards from "@/components/officers/DesignationCards";
import "../tasks/tasks.css";
import "./officers.css";

export default function OfficersPage() {
  return (
    <AuthGuard roles={["ADMIN"]}>
      <div className="tasks-layout">
        <Sidebar />

        <main className="tasks-content">
          <div className="top-navbar">
            <TopSearchBar />
          </div>

          <DesignationCards />
        </main>
      </div>
    </AuthGuard>
  );
}
