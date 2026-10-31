type Props = {
  status: string;
};

export default function StatusBadge({ status }: Props) {
  let background = "#dbeafe";
  let color = "#1d4ed8";

  if (status === "Completed") {
    background = "#dcfce7";
    color = "#15803d";
  }

  if (status === "Pending") {
    background = "#fef3c7";
    color = "#b45309";
  }

  // Same colours as the task register and PDFs.
  if (status === "Overdue") {
    background = "#fbe3e3";
    color = "#c1241e";
  }

  return (
    <span
      style={{
        background,
        color,
        padding: "6px 14px",
        borderRadius: "20px",
        fontWeight: 600,
        fontSize: "14px",
      }}
    >
      {status}
    </span>
  );
}