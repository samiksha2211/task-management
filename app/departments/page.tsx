import Sidebar from "@/components/dashboard/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import TopSearchBar from "@/components/TopSearchBar";
import DepartmentDirectory from "@/components/departments/DepartmentDirectory";
import "../tasks/tasks.css";
import "../officers/officers.css";
import "./departments.css";

export default function DepartmentsPage() {
  return (
    <AuthGuard>
      <div className="tasks-layout">
        <Sidebar />

        <main className="tasks-content">
          <div className="top-navbar">
            <TopSearchBar />
          </div>

          <DepartmentDirectory />
        </main>
      </div>
    </AuthGuard>
  );
}
