import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "@superset/local-db";

import type BetterSqlite3 from "better-sqlite3";
import Database from "better-sqlite3";
import { getTableColumns, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getTableName } from "drizzle-orm/table";
import { app } from "electron";
import { validate as uuidValidate, version as uuidVersion } from "uuid";
import { env } from "../../env.main";
import {
	ensureSupersetHomeDirExists,
	SUPERSET_HOME_DIR,
	SUPERSET_SENSITIVE_FILE_MODE,
} from "../app-environment";

const DB_PATH = join(SUPERSET_HOME_DIR, "local.db");

ensureSupersetHomeDirExists();

/**
 * Gets the migrations directory path.
 *
 * Path resolution strategy:
 * - Production (packaged .app): resources/migrations/
 * - Development (NODE_ENV=development): packages/local-db/drizzle/
 * - Preview (electron-vite preview): dist/resources/migrations/
 * - Test environment: Use monorepo path relative to __dirname
 */
function getMigrationsDirectory(): string {
	// Check if running in Electron (app.getAppPath exists)
	const isElectron =
		typeof app?.getAppPath === "function" &&
		typeof app?.isPackaged === "boolean";

	if (isElectron && app.isPackaged) {
		return join(process.resourcesPath, "resources/migrations");
	}

	const isDev = env.NODE_ENV === "development";

	if (isElectron && isDev) {
		// Development: source files in monorepo
		return join(app.getAppPath(), "../../packages/local-db/drizzle");
	}

	// Preview mode or test: __dirname is dist/main, so go up one level to dist/resources/migrations
	const previewPath = join(__dirname, "../resources/migrations");
	if (existsSync(previewPath)) {
		return previewPath;
	}

	// Fallback: try monorepo path (for tests or dev without Electron)
	// From apps/desktop/src/main/lib/local-db -> packages/local-db/drizzle
	const monorepoPath = join(
		__dirname,
		"../../../../../packages/local-db/drizzle",
	);
	if (existsSync(monorepoPath)) {
		return monorepoPath;
	}

	// Try Electron app path if available
	if (isElectron) {
		const srcPath = join(app.getAppPath(), "../../packages/local-db/drizzle");
		if (existsSync(srcPath)) {
			return srcPath;
		}
	}

	console.warn(`[local-db] Migrations directory not found at: ${previewPath}`);
	return previewPath;
}

const migrationsFolder = getMigrationsDirectory();

const sqlite = new Database(DB_PATH);
try {
	chmodSync(DB_PATH, SUPERSET_SENSITIVE_FILE_MODE);
} catch {
	// Best-effort; directory permissions should still protect the DB.
}
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = OFF");
sqlite.function("uuid_v4", () => randomUUID());
sqlite.function("uuid_is_valid_v4", (value: unknown) => {
	if (typeof value !== "string") return 0;
	if (!uuidValidate(value)) return 0;
	return uuidVersion(value) === 4 ? 1 : 0;
});

console.log(`[local-db] Database initialized at: ${DB_PATH}`);
console.log(`[local-db] Running migrations from: ${migrationsFolder}`);

export const localDb = drizzle(sqlite, { schema });

// Fork upgrade compat: the local fork shipped `0041_folder_workspaces_and_vcs_type`
// before upstream introduced its own `0041_v1_migration_state`. The merge renamed
// the fork migration to `0042`, so users upgrading from fork 1.5.8 have
// `__drizzle_migrations` stopped at the fork 0041 `when` (1776776428315) and a
// schema that already contains vcs_type / section_id. A plain `migrate()` would
// try to run the new 0041 + 0042 in one transaction; the re-ADD of `vcs_type` at
// the end of 0042 fails and rolls back the entire batch, silently leaving
// `v1_migration_state` uncreated and the v1→v2 auto-migration permanently broken.
// Detect that exact fingerprint and pre-apply 0041 + stamp 0042 so drizzle
// migrate() becomes a no-op for those rows.
reconcileForkMigrationDrift(sqlite, migrationsFolder);

let migrateError: unknown = null;
try {
	migrate(localDb, { migrationsFolder });
} catch (error) {
	migrateError = error;
	console.error("[local-db] Migration failed:", error);
}

// Workaround for silent migrate failures (e.g. drizzle recording a migration
// as applied while its ALTER statement silently rolled back — see the
// `0040_agent_preset_permissions_migrated_at` incident on the 1.5.8 merge).
// After migrate(), reconcile every declared schema table against actual
// PRAGMA info and backfill any missing column. Only simple ADD COLUMN is
// attempted — rebuilds, foreign keys and indexes are left to real migrations.
reconcileSchemaDrift(sqlite, schema);

if (migrateError) {
	console.warn(
		"[local-db] Migration failed earlier; continuing after schema reconcile.",
	);
}

console.log("[local-db] Migrations complete");

export type LocalDb = typeof localDb;

type PragmaColumn = { name: string; type: string; notnull: number };

function reconcileSchemaDrift(
	db: BetterSqlite3.Database,
	schemaExports: Record<string, unknown>,
): void {
	for (const value of Object.values(schemaExports)) {
		if (!isDrizzleTable(value)) continue;
		const tableName = getTableName(value);
		const existingColumns = new Set(
			(
				db.prepare(`PRAGMA table_info("${tableName}")`).all() as PragmaColumn[]
			).map((row) => row.name),
		);
		if (existingColumns.size === 0) continue; // table not created yet — leave it to migrate()

		for (const column of Object.values(getTableColumns(value))) {
			const name = column.name;
			if (existingColumns.has(name)) continue;
			if (column.primary) continue; // can't add PK retroactively
			if (column.notNull && column.default === undefined) continue; // can't add NOT NULL without default

			const sqlType = column.getSQLType();
			const defaultClause = buildDefaultClause(column.default);
			const ddl = `ALTER TABLE "${tableName}" ADD COLUMN "${name}" ${sqlType}${defaultClause}`;
			console.warn(
				`[local-db] Schema drift detected: ${tableName}.${name} missing — running: ${ddl}`,
			);
			try {
				db.exec(ddl);
			} catch (error) {
				console.error(
					`[local-db] Failed to backfill ${tableName}.${name}:`,
					error,
				);
			}
		}
	}
}

function isDrizzleTable(value: unknown): value is Table {
	if (typeof value !== "object" || value === null) return false;
	// Drizzle tables carry a non-enumerable internal symbol; getTableName throws otherwise.
	try {
		getTableName(value as Table);
		return true;
	} catch {
		return false;
	}
}

function buildDefaultClause(defaultValue: unknown): string {
	if (defaultValue === undefined) return "";
	if (defaultValue === null) return " DEFAULT NULL";
	if (typeof defaultValue === "number") return ` DEFAULT ${defaultValue}`;
	if (typeof defaultValue === "boolean") {
		return ` DEFAULT ${defaultValue ? 1 : 0}`;
	}
	if (typeof defaultValue === "string") {
		return ` DEFAULT '${defaultValue.replace(/'/g, "''")}'`;
	}
	// SQL expressions / complex defaults: skip to be safe.
	return "";
}

// Fork 0041 (folder_workspaces_and_vcs_type) `when` value, recorded in users'
// __drizzle_migrations before the upstream merge renamed it to 0042.
const FORK_LEGACY_0041_WHEN = 1776776428315;
const UPSTREAM_0041_V1_MIGRATION_STATE_WHEN = 1776928440569;
const RENAMED_0042_FOLDER_WORKSPACES_WHEN = 1776928500000;

function reconcileForkMigrationDrift(
	db: BetterSqlite3.Database,
	migrationsFolder: string,
): void {
	const hasMigrationsTable = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
		)
		.get();
	if (!hasMigrationsTable) return;

	const last = db
		.prepare(
			"SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
		)
		.get() as { created_at: number | bigint } | undefined;
	if (!last) return;
	if (Number(last.created_at) !== FORK_LEGACY_0041_WHEN) return;

	const hasV1MigrationState = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='v1_migration_state'",
		)
		.get();
	if (hasV1MigrationState) return;

	// Verify the fork 0041 actually ran (projects.vcs_type + workspaces.section_id
	// present). If those are missing we're in a different broken state and should
	// not attempt this targeted fix.
	const projectCols = db.prepare("PRAGMA table_info(projects)").all() as Array<{
		name: string;
	}>;
	const workspaceCols = db
		.prepare("PRAGMA table_info(workspaces)")
		.all() as Array<{ name: string }>;
	const hasVcsType = projectCols.some((c) => c.name === "vcs_type");
	const hasSectionId = workspaceCols.some((c) => c.name === "section_id");
	if (!hasVcsType || !hasSectionId) return;

	const sqlPath = join(migrationsFolder, "0041_v1_migration_state.sql");
	if (!existsSync(sqlPath)) return;
	const sqlText = readFileSync(sqlPath, "utf-8");
	const statements = sqlText
		.split("--> statement-breakpoint")
		.map((s) => s.trim())
		.filter(Boolean);

	const v1MigrationHash = createHash("sha256").update(sqlText).digest("hex");
	const folderWorkspacesPath = join(
		migrationsFolder,
		"0042_folder_workspaces_and_vcs_type.sql",
	);
	const folderWorkspacesHash = existsSync(folderWorkspacesPath)
		? createHash("sha256")
				.update(readFileSync(folderWorkspacesPath, "utf-8"))
				.digest("hex")
		: createHash("sha256")
				.update("0042_folder_workspaces_and_vcs_type")
				.digest("hex");

	console.warn(
		"[local-db] Fork migration drift detected — pre-applying 0041_v1_migration_state and stamping 0042.",
	);

	const tx = db.transaction(() => {
		for (const stmt of statements) db.exec(stmt);
		const insert = db.prepare(
			"INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
		);
		insert.run(v1MigrationHash, UPSTREAM_0041_V1_MIGRATION_STATE_WHEN);
		insert.run(folderWorkspacesHash, RENAMED_0042_FOLDER_WORKSPACES_WHEN);
	});

	try {
		tx();
		console.warn("[local-db] Fork migration drift reconciled.");
	} catch (error) {
		console.error(
			"[local-db] Fork migration drift reconcile failed; falling through to migrate():",
			error,
		);
	}
}
