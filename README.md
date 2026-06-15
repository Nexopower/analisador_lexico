# Analizador Léxico con FLEX, NestJS y Vue

Este repositorio ahora usa una arquitectura dividida en dos partes:

- `backend/`: API en NestJS que invoca el lexer generado con FLEX.
- `frontend/`: interfaz en Vue 3 para pegar código Python y ver los tokens.

El lexer principal está en `src/lexer.l` y está enfocado en Python.

## Requisitos

En Windows, necesitas una toolchain que incluya **flex** y **g++**. La recomendación sigue siendo **MSYS2 MinGW-w64**.

### Instalación sugerida

1. Instala MSYS2.
2. Abre **MSYS2 MinGW x64** e instala:

```bash
pacman -S --needed mingw-w64-x86_64-toolchain mingw-w64-x86_64-flex
```

3. Asegúrate de tener en `PATH`:

- `...\msys64\mingw64\bin`

## Backend

Desde `backend/`:

```bash
npm install
npm run start:dev
```

El backend expone:

- `POST /lexer/lex` para tokens léxicos.
- `POST /syntax/analyze` para el análisis sintáctico y generación de AST.

Además, ejecuta automáticamente el build del lexer antes de arrancar.

## Frontend

Desde `frontend/`:

```bash
npm install
npm run dev
```

La interfaz se conecta al backend en `http://localhost:3000`.

## Frontend

Desde `frontend/`:

```bash
npm install
npm run dev
```

La interfaz permite alternar entre análisis léxico y sintáctico.

## Lexer

El lexer generado se compila desde `src/lexer.l` y se usa para analizar código Python.

## Artefactos conservados

- `build/MiniGramaticaLexerGUI.exe` se conserva solo como binario heredado.
- El resto de la antigua GUI Win32 ya no forma parte del flujo actual.
