"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const data = [
  { name: "Completed", value: 98 },
  { name: "Pending", value: 18 },
  { name: "Overdue", value: 10 },
];

const COLORS = ["#22c55e", "#facc15", "#dc2626"];

export default function TaskStatusChart() {
  return (
    <div
  style={{
    background: "#fff",
    borderRadius: "16px",
    padding: "20px",
    marginTop: "20px",
    boxShadow: "0 8px 20px rgba(0,0,0,.08)",
    // remove this
    width: "450px",
    height: "300px",

    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
justifyContent: "flex-start",
  }}
>
      <h2
  style={{
    color: "#163d6b",
    fontSize: "18px",
    fontWeight: "700",
    width: "100%",
    textAlign: "left",
    marginBottom: "5px",
  }}
>
  Task Status
</h2>

      <div
  style={{
    flex: 1,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  }}
>
  <ResponsiveContainer width="75%" height="80%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            outerRadius={75}
            dataKey="value"
            label
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={COLORS[index % COLORS.length]}
              />
            ))}
          </Pie>

          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
</div>
    </div>
  );
}