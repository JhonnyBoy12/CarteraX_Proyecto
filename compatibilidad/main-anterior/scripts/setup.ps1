Write-Host ""
Write-Host "====================================="
Write-Host "       CarteraX - Setup"
Write-Host "====================================="
Write-Host ""

# --------------------------------------------------
# 1. Comprobar Git
# --------------------------------------------------

Write-Host "[1/4] Comprobando Git..."

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Git no esta instalado."
    Write-Host "Instala Git antes de continuar."
    exit 1
}

$gitVersion = git --version
Write-Host "[OK] $gitVersion"

# --------------------------------------------------
# 2. Comprobar Node.js
# --------------------------------------------------

Write-Host ""
Write-Host "[2/4] Comprobando Node.js..."

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {

    Write-Host "[ERROR] Node.js no esta instalado."
    Write-Host ""
    Write-Host "CarteraX necesita Node.js 22.x."
    Write-Host ""
    Write-Host "Si este computador permite instalaciones puedes usar:"
    Write-Host ""
    Write-Host "winget install OpenJS.NodeJS.LTS"
    Write-Host ""
    Write-Host "Luego reinicia PowerShell y ejecuta nuevamente:"
    Write-Host ""
    Write-Host ".\scripts\setup.ps1"

    exit 1
}

$nodeVersion = node --version
Write-Host "[OK] Node.js $nodeVersion"

# --------------------------------------------------
# 3. Comprobar npm
# --------------------------------------------------

Write-Host ""
Write-Host "[3/4] Comprobando npm..."

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] npm no esta disponible."
    Write-Host "Revisa la instalacion de Node.js."
    exit 1
}

$npmVersion = npm --version
Write-Host "[OK] npm $npmVersion"

# --------------------------------------------------
# 4. Instalar dependencias
# --------------------------------------------------

Write-Host ""
Write-Host "[4/4] Instalando dependencias de CarteraX..."
Write-Host ""

npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] No se pudieron instalar las dependencias."
    exit 1
}

Write-Host ""
Write-Host "====================================="
Write-Host "     CarteraX esta preparado"
Write-Host "====================================="
Write-Host ""
Write-Host "Para iniciar el proyecto ejecuta:"
Write-Host ""
Write-Host "npm run dev"
Write-Host ""