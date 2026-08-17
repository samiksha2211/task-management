"use client";

import Link from "next/link";
import { getRole } from "@/lib/api";

export default function AddTaskButton() {
  if (getRole() !== "ADMIN") return null;

  return (
    <Link href="/tasks/add" className="add-task-btn">
      + Add Task
    </Link>
  );
}
