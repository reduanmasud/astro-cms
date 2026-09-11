import type { Db } from "../db/database.ts";

export interface HealthService {
  /** True when the process can serve requests, i.e. SQLite answers a query. */
  isHealthy(): boolean;
}

export function createHealthService({ db }: { db: Db }): HealthService {
  return {
    isHealthy() {
      try {
        db.prepare("SELECT 1").get();
        return true;
      } catch {
        return false;
      }
    },
  };
}
