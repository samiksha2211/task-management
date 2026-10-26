import Sidebar from "@/components/dashboard/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import TopSearchBar from "@/components/TopSearchBar";
import MeetingDashboard from "@/components/meetings/MeetingDashboard";
import "../tasks/tasks.css";
import "./meetings.css";

export default function MeetingsPage() {
  return (
    <AuthGuard roles={["ADMIN"]}>
      <div className="tasks-layout">
        <Sidebar />

        <main className="tasks-content">
          <div className="top-navbar">
            <TopSearchBar />
          </div>

          <MeetingDashboard />
        </main>
      </div>
    </AuthGuard>
  );
}
