%option noyywrap nodefault
%x TRIPLE_SQ TRIPLE_DQ

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

		// Indentation stack and pending indent handling
		static int indent_stack[128];
		static int indent_top = 0; // index of top; indent_stack[0] == 0
		static int pending_indent = -1;
		static int pending_line = 0;
		static int pending_col = 0;
		static int at_bol = 1;

	void lexer_reset_position(void) {
		g_line = 1;
		g_col = 1;
		g_tok_line = 1;
		g_tok_col = 1;
		/* initialize indent tracking state */
		indent_stack[0] = 0;
		indent_top = 0;
		pending_indent = -1;
		pending_line = 0;
		pending_col = 0;
		at_bol = 1;
	}

	static int compute_indent(const char* s, int len) {
		int count = 0;
		for (int i = 0; i < len; ++i) {
			if (s[i] == ' ') count++;
			else if (s[i] == '\t') {
				int add = 8 - (count % 8);
				count += add;
			}
		}
		return count;
	}

	static void apply_pending_indent_if_any(void) {
		if (at_bol && pending_indent < 0) {
			pending_indent = 0;
			pending_line = g_tok_line;
			pending_col = g_tok_col;
		}
		if (pending_indent < 0) return;
		int p = pending_indent;
		if (p > indent_stack[indent_top]) {
			// increase indent
			indent_stack[++indent_top] = p;
			lexer_emit_token((int)LexTokenSeparator, "INDENT", pending_line, pending_col);
		} else {
			while (p < indent_stack[indent_top]) {
				indent_top--;
				lexer_emit_token((int)LexTokenSeparator, "DEDENT", pending_line, pending_col);
			}
			if (p != indent_stack[indent_top]) {
				// mismatched indent -> emit unknown
				lexer_emit_token((int)LexTokenUnknown, "INDENT_ERROR", pending_line, pending_col);
			}
		}
		pending_indent = -1;
	}

%}

/* Definitions */
DIGIT      [0-9]
LETTER     [A-Za-z_]
ID         {LETTER}({LETTER}|{DIGIT})*
INT        {DIGIT}+
EXP        ([eE][+-]?{DIGIT}+)
FLOAT      (({DIGIT}+\.{DIGIT}*|\.{DIGIT}+){EXP}?|{DIGIT}+{EXP})

WS         [ \t]+

/* Python keywords (subset) */
KEYWORDS   "False"|"None"|"True"|"and"|"as"|"assert"|"async"|"await"|"break"|"class"|"continue"|"def"|"del"|"elif"|"else"|"except"|"finally"|"for"|"from"|"global"|"if"|"import"|"in"|"is"|"lambda"|"nonlocal"|"not"|"or"|"pass"|"raise"|"return"|"try"|"while"|"with"|"yield"

%%

"#"[^\n]*                    { /* comment: ignore */ }

\n                            { /* newline: emit NEWLINE and mark BOL */
								  lexer_emit_token((int)LexTokenSeparator, "NEWLINE", g_tok_line, g_tok_col);
								  at_bol = 1; pending_indent = -1; }


{WS}                          {
																	if (at_bol) {
																			pending_indent = compute_indent(yytext, yyleng);
																			pending_line = g_tok_line;
																			pending_col = g_tok_col;
																			/* do not apply until a non-blank token arrives */
																	}
																	/* otherwise ignore whitespace */
																}

f\"([^\"\\]|\\.)*\"         { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenString, yytext, g_tok_line, g_tok_col); }
f'([^'\\]|\\.)*'              { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenString, yytext, g_tok_line, g_tok_col); }
F\"([^\"\\]|\\.)*\"         { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenString, yytext, g_tok_line, g_tok_col); }
F'([^'\\]|\\.)*'              { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenString, yytext, g_tok_line, g_tok_col); }

"'''"                         { BEGIN(TRIPLE_SQ); yymore(); }
"\"\"\""                 { BEGIN(TRIPLE_DQ); yymore(); }

<TRIPLE_SQ>"'''"                 { BEGIN(INITIAL); lexer_emit_token((int)LexTokenString, yytext, g_tok_line, g_tok_col); }
<TRIPLE_SQ>(.|\n)              { yymore(); }

<TRIPLE_DQ>"\"\"\""               { BEGIN(INITIAL); lexer_emit_token((int)LexTokenString, yytext, g_tok_line, g_tok_col); }
<TRIPLE_DQ>(.|\n)             { yymore(); }

\"([^\"\\]|\\.)*\"     { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenString, yytext, g_tok_line, g_tok_col); }
\'([^\'\\]|\\.)*\'       { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenString, yytext, g_tok_line, g_tok_col); }

{FLOAT}                        { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenFloatNumber, yytext, g_tok_line, g_tok_col); }
{INT}                          { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenIntNumber, yytext, g_tok_line, g_tok_col); }

{KEYWORDS}                     { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenKeyword, yytext, g_tok_line, g_tok_col); }

{ID}                           { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenIdentifier, yytext, g_tok_line, g_tok_col); }

"**"|"<<"|">>"|"//"|"=="|"!="|"<="|">="|":=" { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenOperator, yytext, g_tok_line, g_tok_col); }
"\+="|"-="|"\*="|"/="|"%="|"&="|"\|="|"\^=" { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenOperator, yytext, g_tok_line, g_tok_col); }
"\+"|"-"|"\*"|"/"|"%"|"@"|"&"|"\|"|"\^"|"~"|"<"|">"|"="|"<"|">" { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenOperator, yytext, g_tok_line, g_tok_col); }

"("|")"|"["|"]"|"{"|"}"|","|":"|"."|";"     { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenSeparator, yytext, g_tok_line, g_tok_col); }

.                               { apply_pending_indent_if_any(); at_bol = 0; lexer_emit_token((int)LexTokenUnknown, yytext, g_tok_line, g_tok_col); }

<<EOF>>                         {
										apply_pending_indent_if_any();
										while (indent_top > 0) {
											indent_top--;
											lexer_emit_token((int)LexTokenSeparator, "DEDENT", g_tok_line, g_tok_col);
										}
										return 0;
									}

%%



