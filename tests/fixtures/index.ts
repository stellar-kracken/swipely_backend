/**
 * Database state fixtures for integration testing.
 *
 * Each fixture represents a reproducible, named database state that can be
 * loaded before a test and reset afterwards.  Fixtures are deterministic —
 * the same fixture always produces the same rows.
 *
 * Usage:
 *   import { loadFixture, resetFixture, Fixture } from "../fixtures";
 *
 *   beforeEach(() => loadFixture(db, Fixture.HealthyBridge));
 *   afterEach(() => resetFixture(db));
 */

export { Fixture } from "./fixture-registry.js";
export { loadFixture, resetFixture, listLoadedFixtures } from "./fixture-manager.js";
