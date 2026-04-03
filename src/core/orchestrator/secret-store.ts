import { v4 as uuidv4 } from "uuid";
import type { DataStore } from "../data/data-store.js";
import type { HookBus } from "../hooks/hook-bus.js";

export interface SecretInput {
  name: string;
  type?: string;
  environment?: string;
  value?: string;
  location?: string;
  description?: string;
  rotation_schedule?: string;
  expires_at?: string;
  notes?: string;
  org_id?: string;
}

export interface SecretMeta {
  id: string;
  org_id: string | null;
  name: string;
  type: string;
  environment: string;
  location: string | null;
  description: string | null;
  rotation_schedule: string | null;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export class SecretStore {
  private readonly db: DataStore;
  private readonly hooks: HookBus;

  constructor(db: DataStore, hooks: HookBus) {
    this.db = db;
    this.hooks = hooks;
  }

  async set(input: SecretInput): Promise<SecretMeta> {
    const id = uuidv4();
    await this.db.insert("secrets", { ...input, id });
    await this.hooks.emit("secret.created", { name: input.name });
    const row = await this.db.get("secrets", id);
    return this._toMeta(row!);
  }

  async get(name: string, environment = "production"): Promise<string | null> {
    const rows = await this.db.query("secrets", {
      where: { name, environment },
      filters: [{ col: "deleted_at", op: "isNull" as const }],
      limit: 1,
    });
    if (rows.length === 0) return null;
    await this.hooks.emit("secret.accessed", { name, environment });
    return (rows[0].value as string) ?? null;
  }

  async getMeta(
    name: string,
    environment = "production",
  ): Promise<SecretMeta | null> {
    const rows = await this.db.query("secrets", {
      where: { name, environment },
      filters: [{ col: "deleted_at", op: "isNull" as const }],
      limit: 1,
    });
    return rows.length > 0 ? this._toMeta(rows[0]) : null;
  }

  async list(): Promise<SecretMeta[]> {
    const rows = await this.db.query("secrets", {
      filters: [{ col: "deleted_at", op: "isNull" as const }],
      orderBy: "name",
    });
    return rows.map((r) => this._toMeta(r));
  }

  async rotate(name: string, newValue: string, environment = "production"): Promise<void> {
    const rows = await this.db.query("secrets", {
      where: { name, environment },
      filters: [{ col: "deleted_at", op: "isNull" as const }],
      limit: 1,
    });
    if (rows.length === 0) throw new Error(`Secret "${name}" not found`);
    await this.db.update("secrets", rows[0].id as string, {
      value: newValue,
      updated_at: new Date().toISOString(),
    });
    await this.hooks.emit("secret.rotated", { name, environment });
  }

  async delete(name: string, environment = "production"): Promise<void> {
    const rows = await this.db.query("secrets", {
      where: { name, environment },
      filters: [{ col: "deleted_at", op: "isNull" as const }],
      limit: 1,
    });
    if (rows.length === 0) return;
    await this.db.update("secrets", rows[0].id as string, {
      deleted_at: new Date().toISOString(),
    });
    await this.hooks.emit("secret.deleted", { name, environment });
  }

  private _toMeta(row: Record<string, unknown>): SecretMeta {
    return {
      id: row.id as string,
      org_id: (row.org_id as string) ?? null,
      name: row.name as string,
      type: row.type as string,
      environment: row.environment as string,
      location: (row.location as string) ?? null,
      description: (row.description as string) ?? null,
      rotation_schedule: (row.rotation_schedule as string) ?? null,
      expires_at: (row.expires_at as string) ?? null,
      notes: (row.notes as string) ?? null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
