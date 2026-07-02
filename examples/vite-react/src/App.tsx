export function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 40, maxWidth: 640, margin: "0 auto" }}>
      <h1>visual-cursor example</h1>
      <p>
        Run <code>INSPECT=1 npm run dev</code>, then hold ⌘ and hover any component below.
      </p>
      <Card title="Card one" body="Hold ⌘ and hover me." />
      <Card title="Card two" body="Then ⌘-click to open the composer." />
    </main>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginTop: 16 }}>
      <h2 style={{ margin: "0 0 8px" }}>{title}</h2>
      <p style={{ margin: 0, color: "#555" }}>{body}</p>
    </section>
  );
}
