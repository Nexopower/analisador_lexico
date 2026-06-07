@echo off
setlocal

REM Build script for Windows + MinGW-w64 (MSYS2)

cd /d "%~dp0\.."

if not exist "build\gen" mkdir "build\gen"

set "SCANNER=build\gen\lex.yy.c"
set "SCANNER_OBJ=build\gen\lex.yy.o"

where flex >nul 2>nul
if errorlevel 1 goto :noflex

where g++ >nul 2>nul
if errorlevel 1 (
  echo ERROR: g++ no esta en PATH.
  echo Recomendado: instalar MSYS2 toolchain.
  exit /b 1
)

if exist "%SCANNER%" goto :have_scanner

echo [1/2] Generando scanner con FLEX...
flex -o "%SCANNER%" src\lexer.l
if errorlevel 1 exit /b 1
goto :compile

:have_scanner
echo [1/2] Regenerando scanner con FLEX...
flex -o "%SCANNER%" src\lexer.l
if errorlevel 1 exit /b 1
goto :compile

:noflex
if not exist "%SCANNER%" (
  echo ERROR: flex no esta en PATH y no existe %SCANNER%.
  echo Recomendado: instalar MSYS2 y agregar msys64\mingw64\bin al PATH.
  exit /b 1
)

echo WARN: flex no esta en PATH. Usando scanner ya generado: %SCANNER%

:compile
echo [2/2] Compilando scanner C...
gcc -c -O2 -I src -x c "%SCANNER%" -o "%SCANNER_OBJ%"
if errorlevel 1 exit /b 1

echo [2/2] Compilando GUI...
g++ -std=c++17 -O2 -s -mwindows -static -static-libgcc -static-libstdc++ ^
  -municode ^
  -I src ^
  src\main.cpp src\lexer_api.cpp "%SCANNER_OBJ%" ^
  -lcomctl32 -lgdi32 -lole32 -luuid ^
  -o build\MiniGramaticaLexerGUI.exe
if errorlevel 1 exit /b 1

echo OK: build\MiniGramaticaLexerGUI.exe

endlocal
