#pragma once

typedef enum LexTokenType {
	LexTokenKeyword = 0,
	LexTokenIdentifier = 1,
	LexTokenIntNumber = 2,
	LexTokenFloatNumber = 3,
	LexTokenString = 4,
	LexTokenOperator = 5,
	LexTokenSeparator = 6,
	LexTokenUnknown = 7,
} LexTokenType;
