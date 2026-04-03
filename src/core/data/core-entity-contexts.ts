import type { DataStore } from "./data-store.js";
import type { Row } from "./types.js";

/**
 * Define default entity context rendering for botinabox core tables.
 * Call after defineCoreTables() and before or after init().
 *
 * Renders:
 * - agents/ — per-agent context (AGENT.md, PROJECTS.md if agent_project exists)
 * - users/  — per-user context (USER.md) — protected
 * - skills/ — per-skill context (SKILL.md)
 *
 * Apps can override by calling db.defineEntityContext() with the same table name
 * BEFORE calling defineCoreEntityContexts().
 */
export function defineCoreEntityContexts(db: DataStore): void {
  // --- Agents ---
  db.defineEntityContext("agents", {
    table: "agents",
    directory: "agents",
    slugColumn: "slug",
    indexFile: "agents/AGENTS.md",
    files: {
      "AGENT.md": {
        source: { type: "self" },
        render: (rows: Row[]) => {
          const a = rows[0];
          if (!a) return "";
          return [
            `# ${a.name}`,
            "",
            a.role ? `**Role:** ${a.role}` : null,
            a.status ? `**Status:** ${a.status}` : null,
            a.cwd ? `**Working Directory:** ${a.cwd}` : null,
            a.reports_to ? `**Reports To:** ${a.reports_to}` : null,
            "",
          ]
            .filter(Boolean)
            .join("\n");
        },
      },
    },
  });

  // --- Users (protected) ---
  db.defineEntityContext("users", {
    table: "users",
    directory: "users",
    slugColumn: "name",
    protected: true,
    indexFile: "users/USERS.md",
    files: {
      "USER.md": {
        source: { type: "self" },
        render: (rows: Row[]) => {
          const u = rows[0];
          if (!u) return "";
          return [
            `# ${u.name}`,
            "",
            u.role ? `**Role:** ${u.role}` : null,
            u.title ? `**Title:** ${u.title}` : null,
            u.email ? `**Email:** ${u.email}` : null,
            u.timezone ? `**Timezone:** ${u.timezone}` : null,
            "",
          ]
            .filter(Boolean)
            .join("\n");
        },
      },
    },
  });

  // --- Skills ---
  db.defineEntityContext("skills", {
    table: "skills",
    directory: "skills",
    slugColumn: "slug",
    indexFile: "skills/SKILLS.md",
    files: {
      "SKILL.md": {
        source: { type: "self" },
        render: (rows: Row[]) => {
          const s = rows[0];
          if (!s) return "";
          return [
            `# ${s.name}`,
            "",
            s.category ? `**Category:** ${s.category}` : null,
            s.description ? `\n${s.description}` : null,
            s.definition ? `\n## Definition\n\n${s.definition}` : null,
            "",
          ]
            .filter(Boolean)
            .join("\n");
        },
      },
    },
  });

  // --- Messages ---
  db.defineEntityContext("messages", {
    table: "messages",
    directory: "messages",
    slugColumn: "id",
    indexFile: "messages/MESSAGES.md",
    indexRender: (rows: Row[]) => {
      const active = rows.filter((r) => r.deleted_at == null);
      if (!active.length) return "# Messages\n\nNo messages.\n";
      const recent = active.slice(-100);
      const lines = recent.map((r) => {
        const dir = r.direction === "outbound" ? "→" : "←";
        const who = (r.from_agent as string) ?? (r.from_user as string) ?? "unknown";
        const time = ((r.created_at as string) ?? "").slice(0, 16);
        const preview = ((r.body as string) ?? "").slice(0, 80);
        return `- ${dir} **${who}** (${time}): ${preview}`;
      });
      return `# Messages\n\nLast ${lines.length} messages:\n\n${lines.join("\n")}\n`;
    },
    files: {
      "MESSAGE.md": {
        source: { type: "self" },
        render: (rows: Row[]) => {
          const m = rows[0];
          if (!m) return "";
          return [
            "# Message",
            "",
            `**Direction:** ${m.direction}`,
            m.from_user ? `**From User:** ${m.from_user}` : null,
            m.from_agent ? `**From Agent:** ${m.from_agent}` : null,
            `**Channel:** ${m.channel}`,
            m.thread_id ? `**Thread:** ${m.thread_id}` : null,
            m.task_id ? `**Task:** ${m.task_id}` : null,
            `**Time:** ${m.created_at}`,
            "",
            "---",
            "",
            m.body as string,
            "",
          ]
            .filter(Boolean)
            .join("\n");
        },
      },
    },
  });
}
