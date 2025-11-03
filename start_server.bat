@echo off
setlocal ENABLEDELAYEDEXPANSION
pushd %~dp0

REM Si no se pasa argumento, pausamos al final (doble clic)
set NEED_PAUSE=
if "%~1"=="" set NEED_PAUSE=1

echo [INFO] Carpeta del proyecto: %CD%

REM Verificar Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js en PATH.
  echo Instala Node.js 18+ desde https://nodejs.org/ y reintenta.
  if defined NEED_PAUSE pause
  exit /b 1
)

REM Verificar npm
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No se encontro npm en PATH.
  echo Reinstala Node.js para incluir npm y reintenta.
  if defined NEED_PAUSE pause
  exit /b 1
)

REM Instalar/actualizar dependencias siempre (mismo CMD)
echo [INFO] Verificando dependencias (npm install)...
call npm install
if errorlevel 1 (
  echo [ERROR] Fallo la instalacion de dependencias.
  if defined NEED_PAUSE pause
  exit /b 1
)

set PORT=3000
REM Preferir PORT existente o el de .env; fijar 3000 solo si no hay ninguno
if not defined PORT set PORT=3000
if not "%~1"=="" (
  REM Si se pasa un argumento numérico, úsalo como preferido
  for /f "tokens=*" %%A in ("%~1") do set ARGPORT=%%~A
  echo %ARGPORT%| findstr /R "^[0-9][0-9]*$" >nul 2>&1 && set PORT=%ARGPORT%
)

echo [INFO] Iniciando servidor (preferido %PORT%). El puerto real se mostrara abajo.
node server\index.js
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo [ERROR] El servidor finalizo con codigo %ERR%.
  echo Revisa mensajes anteriores. Si persiste, ejecuta en esta misma ventana: npm start
)

if defined NEED_PAUSE pause

popd
endlocal
