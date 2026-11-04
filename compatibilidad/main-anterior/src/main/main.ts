import { app, BrowserWindow } from "electron";
import path from "node:path";
import { getDatabase } from "../database/database";

let mainWindow: BrowserWindow | null = null;

/**
 * Crea la ventana principal de CarteraX y carga la interfaz
 * correspondiente al proceso renderer.
 */
function createWindow(): void {

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile(
        path.join(__dirname, "../renderer/index.html")
    );

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

/**
 * Inicializa los servicios principales de la aplicación.
 */
function initializeApplication(): void {

    // Inicializa la conexión y crea las tablas definidas en schema.sql.
    getDatabase();

    createWindow();
}

app.whenReady().then(() => {

    initializeApplication();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});