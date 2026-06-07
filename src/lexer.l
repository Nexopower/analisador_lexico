%option noyywrap nodefault

%{
	#include <string.h>
	#include "lexer_bridge.h"
	#include "token_types.h"

	// Position tracking (1-based)
	static int g_line = 1;
	static int g_col = 1;
	static int g_tok_line = 1;
	static int g_tok_col = 1;

	static void update_pos(const char* text, int len) {
		for (int i = 0; i < len; i++) {
			if (text[i] == '\n') {
				g_line++;
				g_col = 1;
			} else {
				g_col++;
			}
		}
	}

	#define YY_USER_ACTION \
		g_tok_line = g_line; \
		g_tok_col = g_col; \
		update_pos(yytext, yyleng);

	void lexer_reset_position(void) {
		g_line = 1;
		g_col = 1;
		g_tok_line = 1;
		g_tok_col = 1;
	}
%}

DIGIT      [0-9]
LETTER     [A-Za-z_]
ID         {LETTER}({LETTER}|{DIGIT})*
INT        {DIGIT}+
FLOAT      {DIGIT}+\.{DIGIT}+
WS         [ \t\r\n]+

%%

"//"[^\n]*                    { /* comentario de línea: se ignora */ }
"/*"([^*]|\*+[^*/])*\*+"/"   { /* comentario de bloque: se ignora */ }

{WS}                            { /* whitespace: se ignora */ }

"inicio"|"fin"|"var"|"si"|"sino"|"mientras"|"imprimir"|"func"|"retornar"  {
		lexer_emit_token((int)LexTokenKeyword, yytext, g_tok_line, g_tok_col);
}

{FLOAT}                         { lexer_emit_token((int)LexTokenFloatNumber, yytext, g_tok_line, g_tok_col); }
{INT}                           { lexer_emit_token((int)LexTokenIntNumber, yytext, g_tok_line, g_tok_col); }

\"([^\"\\]|\\.)*\"        { lexer_emit_token((int)LexTokenString, yytext, g_tok_line, g_tok_col); }

"=="|"!="|"<="|">="|"="|"+"|"-"|"*"|"/"|"%"|"<"|">"|"&&"|"||"|"!" {
	lexer_emit_token((int)LexTokenOperator, yytext, g_tok_line, g_tok_col);
}

"("|")"|"{"|"}"|","|";"     { lexer_emit_token((int)LexTokenSeparator, yytext, g_tok_line, g_tok_col); }

{ID}                            { lexer_emit_token((int)LexTokenIdentifier, yytext, g_tok_line, g_tok_col); }

.                               { lexer_emit_token((int)LexTokenUnknown, yytext, g_tok_line, g_tok_col); }

%%
