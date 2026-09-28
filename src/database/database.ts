import Database from "better-sqlite3";
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

// Mantiene una única conexión a la base de datos durante la ejecución.
let db: Database.Database | null = null;

/**
 * Obtiene la conexión principal a la base de datos de CarteraX.
 * Si aún no existe una conexión, se crea utilizando el directorio
 * de datos de la aplicación definido por Electron.
 */
export function getDatabase(): Database.Database {

    if (!db) {
        const databasePath = path.join(
            app.getPath("userData"),
            "carterax.db"
        );

        db = new Database(databasePath);

        // SQLite requiere habilitar explícitamente las claves foráneas.
        db.pragma("foreign_keys = ON");

        initializeDatabase(db);
    }

    return db;
}

/**
 * Inicializa la estructura de la base de datos utilizando el esquema SQL
 * definido para CarteraX.
 */
function initializeDatabase(database: Database.Database): void {

    const schemaPath = path.join(
        __dirname,
        "schema.sql"
    );

    const schema = fs.readFileSync(
        schemaPath,
        "utf-8"
    );

    database.exec(schema);
}