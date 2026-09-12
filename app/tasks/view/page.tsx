import Sidebar from "@/components/dashboard/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import TaskView from "@/components/tasks/TaskView";
import TopSearchBar from "@/components/TopSearchBar";
import "../tasks.css";
import "./view.css";

export default async function ViewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const params = await searchParams;
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;

  return (
    <AuthGuard>
      <div className="tasks-layout">
        <Sidebar />

        <main className="tasks-content">
          <div className="top-navbar">
            <TopSearchBar />
          </div>

          <TaskView id={rawId} />
        </main>
      </div>
    </AuthGuard>
  );
}
