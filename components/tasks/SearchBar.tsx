export default function SearchBar() {
  return (
    <input
      type="text"
      placeholder="Search Tasks..."
      className="task-search"
      style={{
        width: "300px",
        padding: "12px 18px",
        borderRadius: "12px",
        border: "1px solid #d9d9d9",
        outline: "none",
        fontSize: "16px",
      }}
    />
  );
}