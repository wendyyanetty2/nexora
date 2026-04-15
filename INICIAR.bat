@echo off
title NEXORA - Sistema de Control
chcp 65001 >nul
echo.
echo ==========================================
echo    NEXORA - Iniciando sistema...
echo ==========================================
echo.

cd /d "%~dp0"

:: Verificar Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js no esta instalado.
    echo Descarga desde: https://nodejs.org
    pause
    exit /b 1
)

:: Instalar dependencias si no existen
if not exist "node_modules" (
    echo Instalando dependencias por primera vez...
    echo Esto puede tardar 1-2 minutos...
    echo.
    npm install
    echo.
)

echo ==========================================
echo    MODO LOCAL (solo para pruebas tuyas)
echo    http://localhost:3001
echo ==========================================
echo.
echo IMPORTANTE: Este modo es solo para probar
echo en TU computadora.
echo.
echo Para que los trabajadores accedan desde
echo sus celulares o laptops, el sistema debe
echo desplegarse en la nube (ver README.md).
echo.
echo  Admin: DNI 12345678  /  Clave: 1234
echo.
echo NO cierres esta ventana mientras uses
echo el sistema. Para detener: Ctrl+C
echo ==========================================
echo.

start http://localhost:3001
node server.js

pause
