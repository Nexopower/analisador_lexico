#pragma once

#include <string>
#include <vector>

#include "token.h"

std::vector<Token> lex_string(const std::string& input);
