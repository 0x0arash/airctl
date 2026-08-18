import type { GraphPayload } from "../api/client";

export function GraphView({ graph }: { graph: GraphPayload }) {
  const services = graph.nodes.filter((n) => n.kind === "service");
  const width = 960;
  const height = 560;
  const cols = Math.max(1, Math.ceil(Math.sqrt(services.length)));
  const positions = new Map<string, { x: number; y: number }>();
  services.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.set(node.id, {
      x: 120 + col * (width / (cols + 0.5)),
      y: 80 + row * 120,
    });
  });
  graph.nodes
    .filter((n) => n.kind === "project")
    .forEach((node, i) => {
      positions.set(node.id, { x: 80 + i * 180, y: 36 });
    });

  return (
    <section>
      <h1>Topology</h1>
      <p className="muted">Solid lines are observed. Dashed lines are inferred — not facts.</p>
      <svg
        className="graph"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Service topology graph"
      >
        {graph.edges.map((edge) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          return (
            <line
              key={`${edge.from}-${edge.to}-${edge.reason}`}
              className={`edge ${edge.kind}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            >
              <title>{`${edge.kind}: ${edge.reason}`}</title>
            </line>
          );
        })}
        {graph.nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          return (
            <g key={node.id} transform={`translate(${pos.x},${pos.y})`}>
              <circle className="node" r={node.kind === "project" ? 10 : 16} />
              <text x={22} y={4}>
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
