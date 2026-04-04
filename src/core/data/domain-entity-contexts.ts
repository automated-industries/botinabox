import type { DataStore } from "./data-store.js";
import type { Row } from "./types.js";
import { truncateAtWord } from "../../shared/utils.js";

/**
 * Options for domain entity context generation.
 * Match the options used in defineDomainTables().
 */
export interface DomainEntityContextOptions {
  clients?: boolean;
  repositories?: boolean;
  files?: boolean;
  channels?: boolean;
  rules?: boolean;
}

/**
 * Define entity context rendering for standard domain tables.
 * Call after defineDomainTables() and defineCoreTables().
 *
 * Renders per-entity directories with context files for:
 * org, project, + optional client, file, channel entities.
 * Also adds PROJECTS.md, RULES.md, SKILLS.md, REPOS.md to agent context.
 *
 * @example
 * ```ts
 * defineCoreTables(db);
 * defineDomainTables(db);
 * defineCoreEntityContexts(db);    // agents, users, skills
 * defineDomainEntityContexts(db);  // org, project, client, file, channel
 * ```
 */
export function defineDomainEntityContexts(
  db: DataStore,
  options: DomainEntityContextOptions = {},
): void {
  const opts = {
    clients: true,
    repositories: true,
    files: true,
    channels: true,
    rules: true,
    ...options,
  };

  // --- Extend agent context with project/rule/skill connections ---
  // NOTE: This must be called BEFORE defineCoreEntityContexts() or the agent
  // context will already be registered. Apps should call this first, then core.
  // Actually, botinabox registers agents in defineCoreEntityContexts() already.
  // So we skip re-defining agents here — apps add PROJECTS.md etc. themselves.

  // --- Org context ---
  db.defineEntityContext("org", {
    table: "org",
    directory: "orgs",
    slugColumn: "name",
    indexFile: "orgs/ORGS.md",
    files: {
      "ORG.md": {
        source: { type: "self" },
        render: (rows: Row[]) => {
          const o = rows[0];
          if (!o) return "";
          return [
            `# ${o.name}`,
            "",
            o.type ? `**Type:** ${o.type}` : null,
            o.description ? `\n${o.description}` : null,
            o.mission ? `\n**Mission:** ${o.mission}` : null,
            o.website ? `**Website:** ${o.website}` : null,
            "",
          ]
            .filter(Boolean)
            .join("\n");
        },
      },
    },
  });

  // --- Project context ---
  // PROJECT.md auto-combines with all connected context (latticesql 1.2.0+).
  db.defineEntityContext("project", {
    table: "project",
    directory: "projects",
    slugColumn: "name",
    indexFile: "projects/PROJECTS.md",
    files: {
      "PROJECT.md": {
        source: { type: "self" },
        render: (rows: Row[]) => {
          const p = rows[0];
          if (!p) return "";
          return [
            `# ${p.name}`,
            "",
            p.status ? `**Status:** ${p.status}` : null,
            p.description ? `\n${p.description}` : null,
            p.tech_stack ? `\n**Tech Stack:** ${p.tech_stack}` : null,
            p.production_url ? `**URL:** ${p.production_url}` : null,
            p.github_repo ? `**GitHub:** ${p.github_repo}` : null,
            p.deploy_target ? `**Deploy:** ${p.deploy_target}` : null,
            p.branch_strategy
              ? `**Branch Strategy:** ${p.branch_strategy}`
              : null,
            p.notes ? `\n**Notes:**\n${p.notes}` : null,
            "",
          ]
            .filter(Boolean)
            .join("\n");
        },
      },
      ...(opts.repositories
        ? {
            "REPOS.md": {
              source: {
                type: "hasMany" as const,
                table: "repository",
                foreignKey: "project_id",
              },
              render: (rows: Row[]) => {
                if (!rows.length) return "";
                const lines = rows.map(
                  (r) => `- **${r.name}** — ${r.url ?? ""}`,
                );
                return `# Repositories\n\n${lines.join("\n")}\n`;
              },
              omitIfEmpty: true,
            },
          }
        : {}),
      ...(opts.rules
        ? {
            "RULES.md": {
              source: {
                type: "manyToMany" as const,
                junctionTable: "rule_project",
                localKey: "project_id",
                remoteKey: "rule_id",
                remoteTable: "rule",
                softDelete: true,
                orderBy: "priority",
              },
              render: (rows: Row[]) => {
                if (!rows.length) return "";
                const lines = rows.map(
                  (r) => `### ${r.title}\n${r.rule_text}`,
                );
                return `# Project Rules\n\n${lines.join("\n\n")}\n`;
              },
              omitIfEmpty: true,
            },
          }
        : {}),
      "MESSAGES.md": {
        source: {
          type: "hasMany" as const,
          table: "messages",
          foreignKey: "project_id",
          orderBy: "created_at",
          limit: 100,
        },
        render: (rows: Row[]) => {
          if (!rows.length) return "# Messages\n\nNo messages.\n";
          const lines = rows.map((r) => {
            const dir = r.direction === "inbound" ? "\u2192" : "\u2190";
            const ts = ((r.created_at as string) ?? "").slice(0, 16);
            const agent = r.from_agent ? ` [${r.from_agent}]` : "";
            const body = (r.body as string) ?? "";
            const preview = truncateAtWord(body, 150);
            return `- ${dir} **${ts}**${agent} ${preview}`;
          });
          return `# Messages\n\n${lines.join("\n")}\n`;
        },
        omitIfEmpty: false,
      },
    },
  });

  // --- Client context ---
  // CLIENT.md auto-combines with all connected context (latticesql 1.2.0+).
  if (opts.clients) {
    db.defineEntityContext("client", {
      table: "client",
      directory: "clients",
      slugColumn: "name",
      indexFile: "clients/CLIENTS.md",
      files: {
        "CLIENT.md": {
          source: { type: "self" },
          render: (rows: Row[]) => {
            const c = rows[0];
            if (!c) return "";
            return [
              `# ${c.name}`,
              "",
              c.contact_name ? `**Contact:** ${c.contact_name}` : null,
              c.contact_email ? `**Email:** ${c.contact_email}` : null,
              c.phone ? `**Phone:** ${c.phone}` : null,
              c.status ? `**Status:** ${c.status}` : null,
              c.notes ? `\n${c.notes}` : null,
              "",
            ]
              .filter(Boolean)
              .join("\n");
          },
        },
        ...(opts.repositories
          ? {
              "REPOS.md": {
                source: {
                  type: "hasMany" as const,
                  table: "repository",
                  foreignKey: "client_id",
                },
                render: (rows: Row[]) => {
                  if (!rows.length) return "";
                  const lines = rows.map(
                    (r) => `- **${r.name}** — ${r.url ?? ""}`,
                  );
                  return `# Repositories\n\n${lines.join("\n")}\n`;
                },
                omitIfEmpty: true,
              },
            }
          : {}),
        AGENTS: {
          source: {
            type: "manyToMany" as const,
            junctionTable: "agent_client",
            localKey: "client_id",
            remoteKey: "agent_id",
            remoteTable: "agents",
          },
          render: (rows: Row[]) => {
            if (!rows.length) return "";
            const lines = rows.map(
              (r) => `- **${r.name}** (${r.role ?? "agent"})`,
            );
            return `# Assigned Agents\n\n${lines.join("\n")}\n`;
          },
          omitIfEmpty: true,
        },
        "INVOICES.md": {
          source: {
            type: "hasMany" as const,
            table: "invoice",
            foreignKey: "client_id",
          },
          render: (rows: Row[]) => {
            if (!rows.length) return "";
            const lines = rows.map((r) => {
              const amt = r.amount_cents
                ? `$${((r.amount_cents as number) / 100).toFixed(2)}`
                : "TBD";
              return `- **${r.number ?? "Draft"}** — ${amt} (${r.status})${r.description ? ": " + (r.description as string) : ""}`;
            });
            return `# Invoices\n\n${lines.join("\n")}\n`;
          },
          omitIfEmpty: true,
        },
      },
    });
  }

  // --- File context ---
  if (opts.files) {
    db.defineEntityContext("file", {
      table: "file",
      directory: "files",
      slugColumn: "name",
      indexFile: "files/FILES.md",
      files: {
        "FILE.md": {
          source: { type: "self" },
          render: (rows: Row[]) => {
            const f = rows[0];
            if (!f) return "";
            return [
              `# ${f.name}`,
              "",
              f.mime_type ? `**Type:** ${f.mime_type}` : null,
              f.access_level ? `**Access:** ${f.access_level}` : null,
              f.file_path ? `**Path:** ${f.file_path}` : null,
              f.description ? `\n${f.description}` : null,
              "",
            ]
              .filter(Boolean)
              .join("\n");
          },
        },
      },
    });
  }

  // --- Channel context ---
  if (opts.channels) {
    db.defineEntityContext("channel", {
      table: "channel",
      directory: "channels",
      slugColumn: "name",
      indexFile: "channels/CHANNELS.md",
      files: {
        "CHANNEL.md": {
          source: { type: "self" },
          render: (rows: Row[]) => {
            const c = rows[0];
            if (!c) return "";
            return [
              `# ${c.name}`,
              "",
              c.platform ? `**Platform:** ${c.platform}` : null,
              c.type ? `**Type:** ${c.type}` : null,
              c.instructions ? `\n${c.instructions}` : null,
              "",
            ]
              .filter(Boolean)
              .join("\n");
          },
        },
      },
    });
  }
}
