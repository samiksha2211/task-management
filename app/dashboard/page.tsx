import QuickActions from "@/components/dashboard/QuickActions";
import DueToday from "../../components/dashboard/DueToday";
import Sidebar from "@/components/dashboard/Sidebar";
import StatCards from "../../components/dashboard/StatCards";
import RecentTasks from "../../components/dashboard/RecentTasks";
import TaskStatusChart from "@/components/dashboard/charts/TaskStatusChart";
import AuthGuard from "@/components/AuthGuard";
import TopSearchBar from "@/components/TopSearchBar";
import UserBadge from "@/components/UserBadge";
import "./dashboard.css";

export default function Dashboard() {
  return (
    <AuthGuard roles={["ADMIN"]}>
      <div className="dashboard-container">
      <Sidebar />

      <main className="dashboard-content">

        {/* Top Navigation */}
        <div className="top-navbar">
          <TopSearchBar>
            <UserBadge />
          </TopSearchBar>
        </div>

        {/* Welcome */}
        <h1 className="welcome-heading">
          Welcome to RailWork
        </h1>

        {/* Stat Cards */}
        <StatCards />

        {/* Dashboard Layout */}
        <div className="dashboard-grid">

          {/* Left Side */}
          <div className="left-panel">
            <TaskStatusChart />
            <RecentTasks />
          </div>

          {/* Right Side */}
          <div className="right-panel">
            <DueToday />
            <QuickActions />
          </div>

        </div>

      </main>
      </div>
    </AuthGuard>
  );
}