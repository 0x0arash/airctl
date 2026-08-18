export function healthClass(health: string): string {
  if (health === "healthy" || health === "running") return "good";
  if (health === "unhealthy") return "bad";
  if (health === "orphaned") return "warn";
  return "muted";
}
