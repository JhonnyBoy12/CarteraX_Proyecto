Write-Host ""
Write-Host "====================================="
Write-Host "   CarteraX - Preparar computador"
Write-Host "====================================="
Write-Host ""

# Git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Git no esta instalado."
    Write-Host "Instalalo con:"
    Write-Host "winget install --id Git.Git -e"
    exit 1
}

Write-Host "[OK] Git encontrado: $(git --version)"

# Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {

    Write-Host ""
    Write-Host "[INFO] Node.js no esta disponible."
    Write-Host "[INFO] Intentando instalar Node.js LTS mediante winget..."
    Write-Host ""

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] winget no esta disponible."
        Write-Host "Node.js debera instalarse manualmente."
        exit 1
    }

    winget install --id OpenJS.NodeJS.LTS -e

    Write-Host ""
    Write-Host "Node.js fue instalado."
    Write-Host ""
    Write-Host "IMPORTANTE:"
    Write-Host "Cierra esta terminal y abre una nueva."
    Write-Host "Luego ejecuta:"
    Write-Host ""
    Write-Host ".\scripts\bootstrap.ps1"
    exit 0
}

Write-Host "[OK] Node encontrado: $(node --version)"

# npm
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] npm no esta disponible."
    Write-Host "Reinicia la terminal despues de instalar Node.js."
    exit 1
}

Write-Host "[OK] npm encontrado: $(npm --version)"

Write-Host ""
Write-Host "Instalando dependencias de CarteraX..."
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install fallo."
    exit 1
}

Write-Host ""
Write-Host "====================================="
Write-Host "       CarteraX preparado"
Write-Host "====================================="
Write-Host ""
Write-Host "Ejecuta:"
Write-Host "npm run dev"