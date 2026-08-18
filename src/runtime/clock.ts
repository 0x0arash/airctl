export interface Clock {
  now(): Date;
  nowMs(): number;
  isoNow(): string;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }

  isoNow(): string {
    return new Date().toISOString();
  }
}

export class FrozenClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  nowMs(): number {
    return this.current.getTime();
  }

  isoNow(): string {
    return this.current.toISOString();
  }

  set(date: Date): void {
    this.current = date;
  }
}

export function formatAge(fromIso: string | undefined, nowMs: number): string | undefined {
  if (!fromIso) return undefined;
  const then = Date.parse(fromIso);
  if (Number.isNaN(then)) return undefined;
  const seconds = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 48) return remMinutes > 0 ? `${hours}h ${remMinutes}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
