#include "lexer_api.h"
#include "lexer_bridge.h"

#include <cstring>

// FLEX symbols (generated in lex.yy.c)
extern "C" {
	struct yy_buffer_state;
	typedef yy_buffer_state* YY_BUFFER_STATE;

	int yylex(void);
	YY_BUFFER_STATE yy_scan_bytes(const char* bytes, int len);
	void yy_delete_buffer(YY_BUFFER_STATE b);
}

static std::vector<Token>* g_tokens = nullptr;

extern "C" void lexer_emit_token(int token_type, const char* lexeme, int line, int column) {
	if (!g_tokens) {
		return;
	}

	Token token;
	token.type = static_cast<LexTokenType>(token_type);
	token.lexeme = lexeme ? std::string(lexeme) : std::string();
	token.line = line;
	token.column = column;
	g_tokens->push_back(std::move(token));
}

std::vector<Token> lex_string(const std::string& input) {
	std::vector<Token> tokens;
	g_tokens = &tokens;

	// Reset scanning position (line/column) maintained by the scanner.
	lexer_reset_position();

	YY_BUFFER_STATE buf = yy_scan_bytes(input.c_str(), static_cast<int>(input.size()));
	// yylex() scans until EOF; tokens are emitted via lexer_emit_token.
	yylex();
	yy_delete_buffer(buf);

	g_tokens = nullptr;
	return tokens;
}
