const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");

/**
 * Copia un directorio desde src hacia dist.
 */
function copyDirectory(source, destination) {
    fs.mkdirSync(destination, { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
}

// Copia los archivos utilizados por la interfaz.
copyDirectory(
    path.join(projectRoot, "src", "renderer"),
    path.join(projectRoot, "dist", "renderer")
);

// Copia el esquema necesario para inicializar SQLite.
fs.mkdirSync(
    path.join(projectRoot, "dist", "database"),
    { recursive: true }
);

fs.copyFileSync(
    path.join(projectRoot, "src", "database", "schema.sql"),
    path.join(projectRoot, "dist", "database", "schema.sql")
);

console.log("Archivos necesarios copiados correctamente.");