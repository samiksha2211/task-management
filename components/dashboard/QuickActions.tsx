"use client";

import Link from "next/link";
import {
  PlusCircle,
  Users,
  ListChecks,
  BarChart3,
  Trash2,
  Settings,
} from "lucide-react";

export default function QuickActions() {
  const actions = [
    { title: "Add Task", icon: PlusCircle, href: "/tasks/add" },
    { title: "Designation", icon: Users, href: "/officers" },
    { title: "View Tasks", icon: ListChecks, href: "/tasks" },
    { title: "Reports", icon: BarChart3, href: "/reports" },
    { title: "Recycle Bin", icon: Trash2, href: "/recycle-bin" },
    { title: "Settings", icon: Settings, href: "/settings" },
  ];

  return (
    <div className="quick-actions">
      <h2>Quick Actions</h2>

      <div className="quick-grid">
        {actions.map((item, index) => {
          const Icon = item.icon;

          return (
            <Link
              key={index}
              href={item.href}
              className="quick-card quick-card-link"
            >
              <Icon size={28} />
              <span className="quick-title">{item.title}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}