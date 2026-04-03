import { v4 as uuidv4 } from "uuid";
import type { DataStore } from "../data/data-store.js";
import type { HookBus } from "../hooks/hook-bus.js";

export interface UserInput {
  id?: string;
  org_id?: string;
  name: string;
  email?: string;
  role?: string;
  title?: string;
  external_id?: string;
  channel?: string;
  timezone?: string;
  preferences?: string;
  notes?: string;
}

export interface User {
  id: string;
  org_id: string | null;
  name: string;
  email: string | null;
  role: string | null;
  title: string | null;
  external_id: string | null;
  channel: string | null;
  timezone: string | null;
  preferences: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export class UserRegistry {
  private readonly db: DataStore;
  private readonly hooks: HookBus;

  constructor(db: DataStore, hooks: HookBus) {
    this.db = db;
    this.hooks = hooks;
  }

  async register(input: UserInput): Promise<User> {
    const id = input.id ?? uuidv4();
    await this.db.insert("users", { ...input, id });
    const user = await this.db.get("users", id);
    await this.hooks.emit("user.created", { user });
    return user as unknown as User;
  }

  async getById(id: string): Promise<User | null> {
    const row = await this.db.get("users", id);
    return (row as unknown as User) ?? null;
  }

  async getByEmail(email: string): Promise<User | null> {
    const rows = await this.db.query("users", {
      where: { email },
      filters: [{ col: "deleted_at", op: "isNull" as const }],
      limit: 1,
    });
    return rows.length > 0 ? (rows[0] as unknown as User) : null;
  }

  async resolveByIdentity(
    channel: string,
    externalId: string,
  ): Promise<User | null> {
    const identities = await this.db.query("user_identities", {
      where: { channel, external_id: externalId },
      limit: 1,
    });
    if (identities.length === 0) return null;
    return this.getById(identities[0].user_id as string);
  }

  async resolveOrCreate(
    externalId: string,
    channel: string,
    defaults?: Partial<UserInput>,
  ): Promise<User> {
    const existing = await this.resolveByIdentity(channel, externalId);
    if (existing) return existing;

    const user = await this.register({
      name: defaults?.name ?? externalId,
      external_id: externalId,
      channel,
      ...defaults,
    });

    await this.addIdentity(user.id, channel, externalId);
    return user;
  }

  async list(
    filter?: { role?: string; org_id?: string },
  ): Promise<User[]> {
    const where: Record<string, unknown> = {};
    const filters = [{ col: "deleted_at", op: "isNull" as const }];
    if (filter?.role) where.role = filter.role;
    if (filter?.org_id) where.org_id = filter.org_id;
    const rows = await this.db.query("users", { where, filters });
    return rows as unknown as User[];
  }

  async update(id: string, changes: Partial<UserInput>): Promise<void> {
    await this.db.update("users", id, {
      ...changes,
      updated_at: new Date().toISOString(),
    });
  }

  async addIdentity(
    userId: string,
    channel: string,
    externalId: string,
    displayName?: string,
  ): Promise<void> {
    await this.db.insert("user_identities", {
      id: uuidv4(),
      user_id: userId,
      channel,
      external_id: externalId,
      display_name: displayName ?? null,
      verified: 0,
    });
  }
}
