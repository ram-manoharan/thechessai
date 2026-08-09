/** Chrome-less "product screenshot" frame — a title bar with traffic-light
 * dots over arbitrary content — used to make the landing page's demo panels
 * read as real product UI rather than generic marketing graphics. */
export function MockWindow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="card"
      style={{
        overflow: "hidden",
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px",
          background: "var(--bg-elevated)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(224,82,82,0.55)" }} />
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(201,162,68,0.55)" }} />
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(76,175,130,0.55)" }} />
        <span style={{ marginLeft: 8, color: "var(--text-muted)", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}>
          {label}
        </span>
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}
