const fs = require("fs");
const path = require("path");

const source = path.join(__dirname, "..", "src", "renderer");
const destination = path.join(__dirname, "..", "dist", "renderer");

fs.mkdirSync(destination, { recursive: true });

fs.cpSync(source, destination, {
    recursive: true
});

console.log("Assets del renderer copiados correctamente.");