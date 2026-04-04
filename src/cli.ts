#!/usr/bin/env node
/**
 * botinabox CLI — framework utilities.
 *
 * Usage:
 *   botinabox auth google <account-email> --client-id=... --client-secret=...
 *   botinabox auth google <account-email> --credentials=path/to/credentials.json
 */
import * as readline from "node:readline";
import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { checkForUpdate } from "./update-check.js";

function getVersion(): string {
  try {
    const pkgPath = new URL("../package.json", import.meta.url).pathname;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version: string };
    return pkg.version;
  } catch {
    return "unknown";
  }
}

export async function main(args: string[]): Promise<void> {
  const [command, subcommand, ...rest] = args;
  const version = getVersion();

  // Fire-and-forget update check — prints notice on exit
  if (version !== "unknown") {
    checkForUpdate("botinabox", version).then((latest) => {
      if (latest) {
        process.on("exit", () => {
          console.log(
            `\nUpdate available: ${version} → ${latest} — run "botinabox update" to upgrade`,
          );
        });
      }
    }).catch(() => {});
  }

  if (command === "update") {
    await runUpdate(version);
  } else if (command === "--version" || command === "-v") {
    console.log(version);
  } else if (command === "auth" && subcommand === "google") {
    await authGoogle(rest);
  } else {
    console.log("Usage:");
    console.log("  botinabox auth google <account-email> [options]");
    console.log("  botinabox update                              Upgrade to the latest version");
    console.log("  botinabox --version                           Print version");
    console.log("");
    console.log("Options:");
    console.log("  --client-id=<id>           Google OAuth client ID");
    console.log("  --client-secret=<secret>   Google OAuth client secret");
    console.log("  --credentials=<path>       Path to Google credentials JSON");
    console.log("  --db=<path>                Path to SQLite database (default: ./data/lattice.db)");
    console.log("  --scopes=<scopes>          Comma-separated OAuth scopes");
    process.exit(1);
  }
}

async function runUpdate(currentVersion: string): Promise<void> {
  console.log(`Current version: ${currentVersion}`);

  const latest = await checkForUpdate("botinabox", currentVersion);
  if (!latest) {
    console.log("Already up to date.");
    return;
  }

  console.log(`Updating to ${latest}...`);
  try {
    execSync("npm install -g botinabox@latest", { stdio: "inherit" });
    console.log(`Updated botinabox ${currentVersion} → ${latest}`);
  } catch {
    console.error("Update failed. Try running manually: npm install -g botinabox@latest");
    process.exit(1);
  }
}

async function authGoogle(args: string[]): Promise<void> {
  // Parse args
  const flags = new Map<string, string>();
  let account: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, ...valParts] = arg.slice(2).split("=");
      flags.set(key!, valParts.join("="));
    } else if (!account) {
      account = arg;
    }
  }

  if (!account) {
    console.error("Error: account email is required.");
    console.error("  botinabox auth google <account-email> --client-id=... --client-secret=...");
    process.exit(1);
  }

  // Resolve credentials
  let clientId = flags.get("client-id") ?? process.env.GOOGLE_CLIENT_ID;
  let clientSecret = flags.get("client-secret") ?? process.env.GOOGLE_CLIENT_SECRET;

  const credPath = flags.get("credentials");
  if ((!clientId || !clientSecret) && credPath) {
    if (fs.existsSync(credPath)) {
      const creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
      const installed = creds.installed ?? creds.web;
      clientId = clientId ?? installed?.client_id;
      clientSecret = clientSecret ?? installed?.client_secret;
    }
  }

  if (!clientId || !clientSecret) {
    console.error(
      "Error: Google OAuth credentials required.\n" +
        "  Set --client-id and --client-secret, or --credentials=path/to/credentials.json,\n" +
        "  or GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.",
    );
    process.exit(1);
  }

  // Resolve scopes
  const defaultScopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
  ];
  const scopes = flags.has("scopes")
    ? flags.get("scopes")!.split(",")
    : defaultScopes;

  // Resolve DB path
  const dbPath = flags.get("db") ?? process.env.DATABASE_PATH ?? "./data/lattice.db";

  // Initialize DataStore for token persistence
  const { DataStore, defineCoreTables } = await import("./index.js");
  const db = new DataStore({ dbPath });
  defineCoreTables(db);
  await db.init();

  // Token I/O via secrets table
  const tokenLoader = async (key: string): Promise<string | null> => {
    const rows = await db.query("secrets", { where: { name: key } });
    const row = rows.find((r: Record<string, unknown>) => r["deleted_at"] == null);
    return (row?.["value"] as string) ?? null;
  };

  const tokenSaver = async (key: string, value: string): Promise<void> => {
    const rows = await db.query("secrets", { where: { name: key } });
    const existing = rows.find((r: Record<string, unknown>) => r["deleted_at"] == null);
    if (existing) {
      await db.update("secrets", { id: existing["id"] }, {
        value,
        type: "oauth2",
        updated_at: new Date().toISOString(),
      });
    } else {
      await db.insert("secrets", {
        name: key,
        type: "oauth2",
        value,
        description: `Google OAuth tokens for ${account}`,
      });
    }
  };

  // Use the Gmail connector (it handles both Gmail + Calendar scopes)
  const { GoogleGmailConnector } = await import("./connectors/google/gmail-connector.js");

  const connector = new GoogleGmailConnector({ tokenLoader, tokenSaver });

  // Set config without connecting (no tokens yet)
  // We access the private config field via the authenticate flow
  (connector as any).config = {
    account,
    oauth: { clientId, clientSecret, redirectUri: "urn:ietf:wg:oauth:2.0:oob" },
    scopes,
  };

  // Interactive code provider: print URL, read code from stdin
  const codeProvider = async (authUrl: string): Promise<string> => {
    console.log(`\nAuthorize account: ${account}`);
    console.log(`\nOpen this URL in your browser:\n\n  ${authUrl}\n`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise<string>((resolve) => {
      rl.question("Enter the authorization code: ", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  };

  const result = await connector.authenticate!(codeProvider);

  if (result.success) {
    console.log(`\nTokens saved for ${account}. Connector is ready.`);
  } else {
    console.error(`\nAuthentication failed: ${result.error}`);
    process.exit(1);
  }

  db.close();
}
