import { randomUUID } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
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
