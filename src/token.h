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
		return "IDENTIFICADOR";
	case LexTokenIntNumber:
		return "INT";
	case LexTokenFloatNumber:
		return "FLOAT";
	case LexTokenString:
		return "STRING";
	case LexTokenOperator:
		return "OPERADOR";
	case LexTokenSeparator:
		return "SEPARADOR";
	default:
		return "UNKNOWN";
	}
}
