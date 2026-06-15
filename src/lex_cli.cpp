#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include "lexer_api.h"
#include "token.h"

static std::string escape_json(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 16);
    for (char ch : value) {
        switch (ch) {
        case '\\': out += "\\\\"; break;
        case '"': out += "\\\""; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default: out += ch; break;
        }
    }
    return out;
}

int main(int argc, char** argv) {
    std::string input;
    if (argc >= 2) {
        std::ifstream f(argv[1]);
        if (!f) {
            std::cerr << "ERROR: cannot open file: " << argv[1] << "\n";
            return 1;
        }
        std::ostringstream ss;
        ss << f.rdbuf();
        input = ss.str();
    } else {
        // read stdin
        std::ostringstream ss;
        ss << std::cin.rdbuf();
        input = ss.str();
    }

    auto tokens = lex_string(input);
    for (const auto& t : tokens) {
        const char* typeS = token_type_to_string(t.type);
        std::cout
            << "{\"type\":\"" << escape_json(typeS)
            << "\",\"lexeme\":\"" << escape_json(t.lexeme)
            << "\",\"line\":" << t.line
            << ",\"column\":" << t.column
            << "}\n";
    }
    return 0;
}
