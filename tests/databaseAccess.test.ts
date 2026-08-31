import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/database";
import { sleep, withDataRoot } from "./databaseTestSupport";

const ACCESS_PREFIX = "toonflow-access-";

test("ordinary work leases run concurrently through the shared lease", async () => {
  await withDataRoot(ACCESS_PREFIX, async () => {
    const runtime = await openDatabase();
    let inFlight = 0;
    let maxInFlight = 0;

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        runtime.work(async (database) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await sleep(25);
          inFlight -= 1;
          return (await database("o_setting").select("key")).length;
        }),
      ),
    );

    assert.equal(maxInFlight, 4, "ordinary work shares one lease instead of serialising");
    assert.ok(results.every((count) => count > 0), "every lease sees a usable database handle");
    assert.equal(runtime.state, "ready");
  });
});

test("a queued maintenance command is not starved by a stream of new ordinary work", async () => {
  await withDataRoot(ACCESS_PREFIX, async () => {
    const runtime = await openDatabase();
    assert.equal(runtime.state, "ready");

    // Marker that the maintenance readiness rerun is the only thing able to repair.
    await runtime.work((database) => database.schema.dropTableIfExists("o_prompt"));

    let releaseHeldWork!: () => void;
    const heldWork = new Promise<void>((resolve) => {
      releaseHeldWork = resolve;
    });
    const observedStates: string[] = [];

    const held = runtime.work(async (database) => {
      await heldWork;
      return (await database("o_setting").select("key")).length;
    });

    // Queue the writer while ordinary work is still in flight.
    const maintenance = runtime.maintenance({ kind: "verify" });

    // A stream of new ordinary work must not overtake the queued writer: any
    // lease that ran early would still see the dropped table.
    const streamed = Array.from({ length: 5 }, () =>
      runtime.work(async (database) => {
        observedStates.push(runtime.state);
        return database.schema.hasTable("o_prompt");
      }),
    );

    releaseHeldWork();

    assert.deepEqual(await maintenance, { kind: "verify", verified: true }, "the queued writer is not starved");
    const streamedSawRepair = await Promise.all(streamed);

    assert.ok((await held) > 0);
    assert.equal(runtime.state, "ready");
    assert.deepEqual(
      streamedSawRepair,
      [true, true, true, true, true],
      "every parked lease runs after the maintenance readiness rerun, so no new work overtook the writer",
    );
    assert.equal(
      observedStates.filter((state) => state === "maintenance").length,
      0,
      "no ordinary lease may run while maintenance owns the database",
    );
  });
});

test("maintenance reruns the readiness lifecycle before access reopens", async () => {
  await withDataRoot(ACCESS_PREFIX, async () => {
    const runtime = await openDatabase();

    await runtime.work((database) => database.schema.dropTableIfExists("o_prompt"));
    assert.equal(await runtime.work((database) => database.schema.hasTable("o_prompt")), false);

    await runtime.maintenance({ kind: "verify" });

    assert.equal(
      await runtime.work((database) => database.schema.hasTable("o_prompt")),
      true,
      "the full readiness lifecycle reran under exclusive access",
    );
    assert.equal(runtime.state, "ready");
  });
});

test("concurrent maintenance commands all complete and reopen access", async () => {
  await withDataRoot(ACCESS_PREFIX, async () => {
    const runtime = await openDatabase();

    const results = await Promise.all([
      runtime.maintenance({ kind: "verify" }),
      runtime.maintenance({ kind: "verify" }),
    ]);

    assert.deepEqual(results, [
      { kind: "verify", verified: true },
      { kind: "verify", verified: true },
    ]);
    assert.equal(runtime.state, "ready", "access reopens only after revalidation");
    const settings = await runtime.work((database) => database("o_setting").select("key"));
    assert.ok(settings.length > 0);
  });
});

test("ordinary work released by maintenance still observes a validated database", async () => {
  await withDataRoot(ACCESS_PREFIX, async () => {
    const runtime = await openDatabase();

    const [maintenanceResult, workResult] = await Promise.all([
      runtime.maintenance({ kind: "verify" }),
      runtime.work(async (database) => database("o_setting").where("key", "tokenKey").first()),
    ]);

    assert.deepEqual(maintenanceResult, { kind: "verify", verified: true });
    assert.ok(workResult, "work queued behind maintenance reads a validated database");
    assert.ok(String(workResult.value).length > 0);
  });
});
