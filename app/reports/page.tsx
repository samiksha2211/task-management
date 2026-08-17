import Sidebar from "@/components/dashboard/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import TopSearchBar from "@/components/TopSearchBar";
import ReportsDashboard from "@/components/reports/ReportsDashboard";
import "../tasks/tasks.css";
import "./reports.css";

export default function ReportsPage() {
  return (
    <AuthGuard roles={["ADMIN"]}>
      <div className="tasks-layout">
        <Sidebar />

        <main className="tasks-content">
          <div className="top-navbar">
            <TopSearchBar />
          </div>

          <ReportsDashboard />
        </main>
      </div>
    </AuthGuard>
  );
}
