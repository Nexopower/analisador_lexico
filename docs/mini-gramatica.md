# “mi mini gramática” — Lenguaje de prueba (para el lexer)

El analizador reconoce los siguientes **tokens**:

## Palabras reservadas

- `inicio`, `fin`
- `var`
- `si`, `sino`
- `mientras`
- `imprimir`
- `func`, `retornar`

## Identificadores

- Patrón: `[A-Za-z_][A-Za-z0-9_]*`
- Ejemplos: `x`, `_tmp1`, `contador`

## Números

- Entero: `[0-9]+` (ej.: `0`, `42`, `1234`)
- Real: `[0-9]+\.[0-9]+` (ej.: `3.14`, `10.0`)

## Cadenas

- Patrón: `"([^"\\]|\\.)*"`
- Ejemplos: `"hola"`, `"línea\\n2"`

## Operadores

- Aritméticos: `+ - * / %`
- Asignación: `=`
- Comparación: `== != < <= > >=`
- Lógicos: `&& || !`

## Separadores

- `(` `)` `{` `}` `,` `;`

## Comentarios (se ignoran)

- De línea: `// ...` hasta fin de línea
- De bloque: `/* ... */` (multilínea)

## Ejemplo de programa

```txt
inicio
  var x = 10;
  var y = 3.14;
  // comentario
  si (x >= 10 && y != 0.0) {
    imprimir("ok");
  } sino {
    imprimir("no");
  }
fin
```
