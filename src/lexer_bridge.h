#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Called by the FLEX-generated scanner.
void lexer_emit_token(int token_type, const char* lexeme, int line, int column);

// Called by the wrapper before scanning.
void lexer_reset_position(void);

#ifdef __cplusplus
}
#endif
