import { v4 as uuidv4 } from "uuid";
import { scryptSync, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { DataStore } from "../data/data-store.js";
import type { HookBus } from "../hooks/hook-bus.js";

const ENC_PREFIX = "enc:";
const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveEncKey(masterKey: string): Buffer {
  return scryptSync(masterKey, "botinabox-secrets-v1", 32);
}

function encryptValue(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptValue(ciphertext: string, key: Buffer): string {
  if (!ciphertext.startsWith(ENC_PREFIX)) return ciphertext; // plaintext passthrough for migration
  const buf = Buffer.from(ciphertext.slice(ENC_PREFIX.length), "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString("utf8") + decipher.final("utf8");
}

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
  private readonly encKey: Buffer | null;

  /**
   * @param db - DataStore instance
   * @param hooks - HookBus instance
   * @param encryptionKey - Optional master key for encrypting secrets at rest.
   *   When provided, all new secrets are encrypted with AES-256-GCM.
   *   Existing plaintext secrets are read transparently (passthrough on decrypt).
   */
  constructor(db: DataStore, hooks: HookBus, encryptionKey?: string) {
    this.db = db;
    this.hooks = hooks;
    this.encKey = encryptionKey ? deriveEncKey(encryptionKey) : null;
  }

  async set(input: SecretInput): Promise<SecretMeta> {
    const id = uuidv4();
    const data = { ...input, id };
    if (this.encKey && data.value) {
      data.value = encryptValue(data.value, this.encKey);
    }
    await this.db.insert("secrets", data);
    await this.hooks.emit("secret.created", { name: input.name });
    const inserted = await this.db.get("secrets", id);
    return this._toMeta(inserted!);
  }

  async get(name: string, environment = "production"): Promise<string | null> {
    const rows = await this.db.query("secrets", {
      where: { name, environment },
      filters: [{ col: "deleted_at", op: "isNull" as const }],
      limit: 1,
    });
    if (rows.length === 0) return null;
    await this.hooks.emit("secret.accessed", { name, environment });
    const raw = (rows[0].value as string) ?? null;
    if (raw && this.encKey) return decryptValue(raw, this.encKey);
    return raw;
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
    const storedValue = this.encKey ? encryptValue(newValue, this.encKey) : newValue;
    await this.db.update("secrets", rows[0].id as string, {
      value: storedValue,
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

  // ── Cursor persistence helpers ──────────────────────────────────

  /**
   * Load a sync cursor by key. Returns undefined if not found.
   * Cursors are stored as secrets with type='sync_cursor'.
   */
  async loadCursor(key: string): Promise<string | undefined> {
    const name = `sync-cursor:${key}`;
    const rows = await this.db.query("secrets", {
      where: { name },
      filters: [{ col: "deleted_at", op: "isNull" as const }],
      limit: 1,
    });
    const raw = (rows[0]?.value as string) ?? undefined;
    if (raw && this.encKey) return decryptValue(raw, this.encKey);
    return raw;
  }

  /**
   * Persist a sync cursor by key. Creates or updates the secret.
   */
  async saveCursor(key: string, value: string): Promise<void> {
    const name = `sync-cursor:${key}`;
    const storedValue = this.encKey ? encryptValue(value, this.encKey) : value;
    const rows = await this.db.query("secrets", {
      where: { name },
      filters: [{ col: "deleted_at", op: "isNull" as const }],
      limit: 1,
    });
    if (rows.length > 0) {
      await this.db.update("secrets", rows[0].id as string, {
        value: storedValue,
        updated_at: new Date().toISOString(),
      });
    } else {
      await this.db.insert("secrets", {
        id: uuidv4(),
        name,
        type: "sync_cursor",
        value: storedValue,
      });
    }
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
