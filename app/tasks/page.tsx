import Sidebar from "@/components/dashboard/Sidebar";
import TaskTable from "@/components/tasks/TaskTable";
import AuthGuard from "@/components/AuthGuard";
import TopSearchBar from "@/components/TopSearchBar";
import AddTaskButton from "@/components/tasks/AddTaskButton";
import "./tasks.css";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const rawSearch = Array.isArray(params.search) ? params.search[0] : params.search;
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const initialStatus =
    rawStatus &&
    ["pending", "completed", "overdue", "pending_overdue"].includes(rawStatus.toLowerCase())
      ? rawStatus.toLowerCase()
      : "all";

  return (
    <AuthGuard>
      <div className="tasks-layout">
        <Sidebar />

        <main className="tasks-content">
          <div className="top-navbar">
            <TopSearchBar />
          </div>

          <div className="page-header">
            <h1 className="page-title">Task Management</h1>

            <AddTaskButton />
          </div>

          <TaskTable
            key={`${rawSearch ?? ""}-${initialStatus}`}
            initialSearch={rawSearch}
            initialStatus={initialStatus}
          />
        </main>
      </div>
    </AuthGuard>
  );
}
