# analisador-lexico backend

Scaffold mínimo NestJS para exponer un endpoint de lexing.

Instrucciones rápidas:

1. Instalar dependencias:

```bash
npm install
```

2. Ejecutar en modo desarrollo:

```bash
npm run start:dev
```

El servicio expone `POST /lexer/lex` con body `{ "code": "..." }`.

También expone `POST /syntax/analyze` para obtener un AST y errores sintácticos.

El servicio intentará ejecutar un binario de lexer compilado en `build/lex.yy.exe` o `build/lex.yy`. Si no existe, usa un tokenizer de respaldo.

Nota: al ejecutar `npm start` o `npm run start:dev` desde `backend/`, se ejecutará automáticamente `npm run build-lexer` (si está disponible en el entorno) para compilar el scanner Flex y generar `build/lex.yy.exe`.
