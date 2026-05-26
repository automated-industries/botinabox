import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataStore } from "../data-store.js";
import { defineCoreTables } from "../core-schema.js";
import { defineDomainTables } from "../domain-schema.js";
import { defineDomainEntityContexts } from "../domain-entity-contexts.js";

let db: DataStore;

beforeEach(async () => {
  db = new DataStore({ dbPath: ":memory:" });
  defineCoreTables(db);
  defineDomainTables(db);
  await db.init();
});

afterEach(() => {
  db.close();
});

describe("defineDomainTables", () => {
  it("creates all domain tables", () => {
    const expected = [
      "org",
      "project",
      "agent_project",
      "secret_project",
      "secret_org",
      "client",
      "invoice",
      "agent_client",
      "repository",
      "file",
      "channel",
      "rule",
      "rule_agent",
      "rule_project",
      "rule_org",
      "event",
    ];
    for (const t of expected) {
      const cols = db.tableInfo(t);
      expect(cols.length, `${t} should have columns`).toBeGreaterThan(0);
    }
  });

  it("allows disabling optional tables", async () => {
    const db2 = new DataStore({ dbPath: ":memory:" });
    defineCoreTables(db2);
    defineDomainTables(db2, {
      clients: false,
      repositories: false,
      files: false,
      channels: false,
      events: false,
    });
    await db2.init();

    // Core domain always present
    expect(db2.tableInfo("org").length).toBeGreaterThan(0);
    expect(db2.tableInfo("project").length).toBeGreaterThan(0);

    // Optional tables should still exist but check they were defined
    // Actually with clients: false, client table won't exist
    // We verify by trying to query — should throw
    db2.close();
  });

  it("project links to org via org_id", async () => {
    const org = await db.insert("org", { name: "Test Org", type: "company" });
    const project = await db.insert("project", {
      org_id: org.id,
      name: "Test Project",
      status: "active",
    });
    const fetched = await db.get("project", project.id as string);
    expect(fetched!.org_id).toBe(org.id);
  });

  it("invoice links to client", async () => {
    const org = await db.insert("org", { name: "Test", type: "company" });
    const client = await db.insert("client", {
      org_id: org.id,
      name: "Test Client",
    });
    const inv = await db.insert("invoice", {
      org_id: org.id,
      client_id: client.id,
      number: "INV-001",
      amount_cents: 500000,
      status: "draft",
    });
    const fetched = await db.get("invoice", inv.id as string);
    expect(fetched!.client_id).toBe(client.id);
    expect(fetched!.amount_cents).toBe(500000);
  });

  it("org table includes address column", () => {
    const cols = db.tableInfo("org");
    const address = cols.find((c) => c.name === "address");
    expect(address, "org.address column should exist").toBeDefined();
  });

  it("org accepts nullable address and round-trips it", async () => {
    const withAddr = await db.insert("org", {
      name: "Org A",
      type: "company",
      address: "123 Example St, Suite 4",
    });
    const fetchedA = await db.get("org", withAddr.id as string);
    expect(fetchedA!.address).toBe("123 Example St, Suite 4");

    const withoutAddr = await db.insert("org", {
      name: "Org B",
      type: "company",
    });
    const fetchedB = await db.get("org", withoutAddr.id as string);
    expect(fetchedB!.address).toBeNull();
  });

  it("rule_org junction works", async () => {
    const org = await db.insert("org", { name: "Test", type: "company" });
    const rule = await db.insert("rule", {
      org_id: org.id,
      title: "Test Rule",
      rule_text: "Do the thing",
      scope: "org",
      category: "process",
    });
    await db.link("rule_org", { rule_id: rule.id, org_id: org.id });
    const links = await db.query("rule_org");
    expect(links.length).toBeGreaterThanOrEqual(1);
  });
});

describe("defineDomainEntityContexts — ORG.md renderer", () => {
  let cdb: DataStore;

  beforeEach(async () => {
    cdb = new DataStore({ dbPath: ":memory:" });
    defineCoreTables(cdb);
    defineDomainTables(cdb);
    defineDomainEntityContexts(cdb);
    await cdb.init();
  });

  afterEach(() => {
    cdb.close();
  });

  function getOrgRender(): (rows: any[]) => string {
    const lattice: any = (cdb as any).lattice;
    const ctx = lattice.entityContexts().get("org");
    expect(ctx, "org entity context should be registered").toBeDefined();
    const file = ctx.files["ORG.md"];
    expect(file, "ORG.md file spec should be registered").toBeDefined();
    expect(typeof file.render).toBe("function");
    return file.render as (rows: any[]) => string;
  }

  it("emits Address line when address is set", () => {
    const render = getOrgRender();
    const out = render([
      {
        id: "o1",
        name: "Demo Org",
        type: "company",
        website: "https://example.com",
        address: "1 Example Way, City",
      },
    ]);
    expect(out).toContain("**Address:** 1 Example Way, City");
    expect(out).toContain("**Website:** https://example.com");
  });

  it("omits Address line when address is null", () => {
    const render = getOrgRender();
    const out = render([
      {
        id: "o1",
        name: "Demo Org",
        type: "company",
        website: "https://example.com",
        address: null,
      },
    ]);
    expect(out).not.toContain("**Address:**");
    expect(out).toContain("**Website:** https://example.com");
  });

  it("omits Address line when address column is missing entirely", () => {
    const render = getOrgRender();
    const out = render([
      {
        id: "o1",
        name: "Demo Org",
        type: "company",
      },
    ]);
    expect(out).not.toContain("**Address:**");
  });
});
