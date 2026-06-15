@echo off
setlocal

REM Build a console lexer binary (Windows, MSYS2/MinGW-w64 recommended)

cd /d "%~dp0\.."

if not exist "build\gen" mkdir "build\gen"

set "SCANNER=build\gen\lex.yy.c"
set "SCANNER_OBJ=build\gen\lex.yy.o"
set "BIN=build\lex.yy.exe"

where flex >nul 2>nul
if errorlevel 1 goto :noflex

where g++ >nul 2>nul
if errorlevel 1 (
  echo ERROR: g++ no esta en PATH.
  echo Recomendado: instalar MSYS2 toolchain.
  exit /b 1
)

echo [1/2] Generando/regenerando scanner con FLEX...
flex -o "%SCANNER%" src\lexer.l
if errorlevel 1 exit /b 1

echo [2/2] Compilando scanner C++ CLI...
gcc -c -O2 -I src -x c "%SCANNER%" -o "%SCANNER_OBJ%"
if errorlevel 1 exit /b 1

g++ -std=c++17 -O2 -s -I src src\lexer_api.cpp src\lex_cli.cpp "%SCANNER_OBJ%" -o "%BIN%"
if errorlevel 1 exit /b 1

echo OK: %BIN%

endlocal

goto :eof

:noflex
if not exist "%SCANNER%" (
  echo ERROR: flex no esta en PATH y no existe %SCANNER%.
  echo Recomendado: instalar MSYS2 y agregar msys64\mingw64\bin al PATH.
  exit /b 1
)

echo WARN: flex no esta en PATH. Usando scanner ya generado: %SCANNER%
goto :compile
