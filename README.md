# Analizador Léxico con FLEX (GUI) — “mi mini gramática”

Este proyecto implementa un **analizador léxico** usando **FLEX** y lo integra en una **app gráfica (Windows)** (Win32 + C++17, **sin consola**). La GUI permite pegar código fuente, presionar **Analizar** y ver la **tabla de tokens** (tipo, lexema, línea, columna).

## Requisitos

En Windows, necesitas una toolchain que incluya **flex** y **g++** (recomendado: **MSYS2 MinGW-w64**).

### Opción recomendada: MSYS2

1) Instala MSYS2.

2) Abre **MSYS2 MinGW x64** e instala:

```bash
pacman -S --needed mingw-w64-x86_64-toolchain mingw-w64-x86_64-flex
```

3) Asegúrate de tener en `PATH`:

- `...\msys64\mingw64\bin` (para `g++` y `flex`)

## Compilación (genera el .exe)

Desde `cmd` (o PowerShell) en la carpeta del proyecto:

```bat
build\build.bat
```

Salida:

- `build\MiniGramaticaLexerGUI.exe`

## Uso

1) Ejecuta `build\MiniGramaticaLexerGUI.exe`
2) Pega un programa de prueba
3) Clic en **Analizar**

## Lenguaje de prueba (“mi mini gramática”)

La especificación de tokens y ejemplos está documentada en:

- `docs/mini-gramatica.md`

## Autómata / explicación

Una explicación simplificada del autómata (DFA) para algunos tokens clave:

- `docs/automata.md`

## Entrega en GitHub

- Sube el **código fuente completo**.
- Incluye el ejecutable `build/MiniGramaticaLexerGUI.exe` en un **Release** (recomendado) o en un zip.
