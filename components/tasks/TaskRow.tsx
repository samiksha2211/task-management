import StatusBadge from "./StatusBadge";

interface TaskRowProps {
  task: {
    id: string;
    task: string;
    officer: string;
    status: string;
    dueDate: string;
  };
}

export default function TaskRow({ task }: TaskRowProps) {
  return (
    <tr>
      <td>{task.id}</td>
      <td>{task.task}</td>
      <td>{task.officer}</td>

      <td>
        <StatusBadge status={task.status} />
      </td>

      <td>{task.dueDate}</td>

      <td>
        <div className="action-buttons">
    <button className="view-btn">View</button>
    <button className="edit-btn">Edit</button>
    <button className="delete-btn">Delete</button>
</div>
      </td>
    </tr>
  );
}