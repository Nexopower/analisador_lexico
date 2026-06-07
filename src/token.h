#pragma once

#include "token_types.h"
#include <string>

struct Token {
	LexTokenType type;
	std::string lexeme;
	int line;
	int column;
};

inline const char* token_type_to_string(LexTokenType type) {
	switch (type) {
	case LexTokenKeyword:
		return "KEYWORD";
	case LexTokenIdentifier:
		return "IDENT";
	case LexTokenIntNumber:
		return "INT";
	case LexTokenFloatNumber:
		return "FLOAT";
	case LexTokenString:
		return "STRING";
	case LexTokenOperator:
		return "OP";
	case LexTokenSeparator:
		return "SEP";
	default:
		return "UNKNOWN";
	}
}
