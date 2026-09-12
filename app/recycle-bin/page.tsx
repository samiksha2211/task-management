import Sidebar from "@/components/dashboard/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import TopSearchBar from "@/components/TopSearchBar";
import RecycleBin from "@/components/recycle/RecycleBin";
import "../tasks/tasks.css";
import "./recycle.css";

export default function RecycleBinPage() {
  return (
    <AuthGuard roles={["ADMIN"]}>
      <div className="tasks-layout">
        <Sidebar />

        <main className="tasks-content">
          <div className="top-navbar">
            <TopSearchBar />
          </div>

          <RecycleBin />
        </main>
      </div>
    </AuthGuard>
  );
}
