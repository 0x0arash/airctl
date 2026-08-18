import type { StatusPayload } from "../api/client";

export function ProjectsView({ status }: { status: StatusPayload }) {
  return (
    <section>
      <h1>Projects</h1>
      {status.projects.length === 0 ? (
        <p className="muted">No projects detected from process working directories.</p>
      ) : null}
      {status.projects.map((project) => {
        const services = status.services.filter((s) => s.projectId === project.id);
        return (
          <article className="inspect" key={project.id}>
            <h2>{project.name}</h2>
            <p className="mono muted">{project.root}</p>
            <ul>
              {services.map((service) => (
                <li key={service.id}>
                  {service.name} {service.ports.map((p) => `:${p}`).join(" ")} — {service.health}
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </section>
  );
}
