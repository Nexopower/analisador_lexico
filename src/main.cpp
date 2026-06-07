#define UNICODE
#define _UNICODE

#include <windows.h>
#include <commctrl.h>

#include <algorithm>
#include <string>
#include <vector>

#include "lexer_api.h"

static const wchar_t* kWindowClass = L"MiniGramaticaLexerGUI";
static const int kControlMargin = 10;
static const int kButtonHeight = 28;
static const int kInputMinHeight = 140;

enum ControlId : int {
	IDC_INPUT = 1001,
	IDC_ANALYZE = 1002,
	IDC_LIST = 1003,
};

static std::string wide_to_utf8(const std::wstring& w) {
	if (w.empty()) return {};
	int needed = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
	std::string out;
	out.resize(needed);
	WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), out.data(), needed, nullptr, nullptr);
	return out;
}

static std::wstring get_window_text_w(HWND hWnd) {
	int len = GetWindowTextLengthW(hWnd);
	std::wstring text;
	text.resize(len + 1);
	GetWindowTextW(hWnd, text.data(), len + 1);
	text.resize(wcslen(text.c_str()));
	return text;
}

static void listview_clear(HWND hList) {
	ListView_DeleteAllItems(hList);
}

static void listview_insert_columns(HWND hList) {
	LVCOLUMNW col{};
	col.mask = LVCF_TEXT | LVCF_WIDTH | LVCF_SUBITEM;

	col.pszText = (LPWSTR)L"Tipo";
	col.cx = 110;
	col.iSubItem = 0;
	ListView_InsertColumn(hList, 0, &col);

	col.pszText = (LPWSTR)L"Lexema";
	col.cx = 280;
	col.iSubItem = 1;
	ListView_InsertColumn(hList, 1, &col);

	col.pszText = (LPWSTR)L"Línea";
	col.cx = 60;
	col.iSubItem = 2;
	ListView_InsertColumn(hList, 2, &col);

	col.pszText = (LPWSTR)L"Col";
	col.cx = 60;
	col.iSubItem = 3;
	ListView_InsertColumn(hList, 3, &col);
}

static void listview_add_token(HWND hList, int index, const Token& tok) {
	std::wstring typeW;
	{
		const char* s = token_type_to_string(tok.type);
		int needed = MultiByteToWideChar(CP_UTF8, 0, s, -1, nullptr, 0);
		typeW.resize(needed > 0 ? needed : 0);
		if (needed > 0) {
			MultiByteToWideChar(CP_UTF8, 0, s, -1, typeW.data(), needed);
			if (!typeW.empty() && typeW.back() == L'\0') typeW.pop_back();
		}
	}

	std::wstring lexW;
	{
		int needed = MultiByteToWideChar(CP_UTF8, 0, tok.lexeme.c_str(), -1, nullptr, 0);
		lexW.resize(needed > 0 ? needed : 0);
		if (needed > 0) {
			MultiByteToWideChar(CP_UTF8, 0, tok.lexeme.c_str(), -1, lexW.data(), needed);
			if (!lexW.empty() && lexW.back() == L'\0') lexW.pop_back();
		}
	}

	wchar_t lineBuf[32];
	wsprintfW(lineBuf, L"%d", tok.line);
	wchar_t colBuf[32];
	wsprintfW(colBuf, L"%d", tok.column);

	LVITEMW item{};
	item.mask = LVIF_TEXT;
	item.iItem = index;
	item.iSubItem = 0;
	item.pszText = (LPWSTR)typeW.c_str();
	ListView_InsertItem(hList, &item);
	ListView_SetItemText(hList, index, 1, (LPWSTR)lexW.c_str());
	ListView_SetItemText(hList, index, 2, lineBuf);
	ListView_SetItemText(hList, index, 3, colBuf);
}

static void do_analyze(HWND hWnd) {
	HWND hInput = GetDlgItem(hWnd, IDC_INPUT);
	HWND hList = GetDlgItem(hWnd, IDC_LIST);
	if (!hInput || !hList) return;

	listview_clear(hList);

	std::wstring srcW = get_window_text_w(hInput);
	std::string src = wide_to_utf8(srcW);
	std::vector<Token> tokens = lex_string(src);

	for (int i = 0; i < (int)tokens.size(); i++) {
		listview_add_token(hList, i, tokens[i]);
	}
}

static void layout_controls(HWND hWnd) {
	RECT rc{};
	GetClientRect(hWnd, &rc);
	int w = rc.right - rc.left;
	int h = rc.bottom - rc.top;

	int x = kControlMargin;
	int y = kControlMargin;
	int cw = w - 2 * kControlMargin;
	int inputH = std::max(kInputMinHeight, (h - 3 * kControlMargin - kButtonHeight) / 3);

	HWND hInput = GetDlgItem(hWnd, IDC_INPUT);
	HWND hButton = GetDlgItem(hWnd, IDC_ANALYZE);
	HWND hList = GetDlgItem(hWnd, IDC_LIST);

	if (hInput) MoveWindow(hInput, x, y, cw, inputH, TRUE);
	y += inputH + kControlMargin;
	if (hButton) MoveWindow(hButton, x, y, 140, kButtonHeight, TRUE);
	y += kButtonHeight + kControlMargin;
	if (hList) MoveWindow(hList, x, y, cw, h - y - kControlMargin, TRUE);
}

static LRESULT CALLBACK WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
	switch (msg) {
	case WM_CREATE: {
		HWND hInput = CreateWindowExW(
			WS_EX_CLIENTEDGE,
			L"EDIT",
			L"inicio\r\n  var x = 10;\r\n  imprimir(\"hola\");\r\nfin\r\n",
			WS_CHILD | WS_VISIBLE | ES_MULTILINE | ES_AUTOVSCROLL | ES_WANTRETURN | WS_VSCROLL,
			0,
			0,
			0,
			0,
			hWnd,
			(HMENU)IDC_INPUT,
			(HINSTANCE)GetWindowLongPtrW(hWnd, GWLP_HINSTANCE),
			nullptr);
		SendMessageW(hInput, WM_SETFONT, (WPARAM)GetStockObject(DEFAULT_GUI_FONT), TRUE);

		HWND hBtn = CreateWindowExW(
			0,
			L"BUTTON",
			L"Analizar",
			WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
			0,
			0,
			0,
			0,
			hWnd,
			(HMENU)IDC_ANALYZE,
			(HINSTANCE)GetWindowLongPtrW(hWnd, GWLP_HINSTANCE),
			nullptr);
		SendMessageW(hBtn, WM_SETFONT, (WPARAM)GetStockObject(DEFAULT_GUI_FONT), TRUE);

		HWND hList = CreateWindowExW(
			WS_EX_CLIENTEDGE,
			WC_LISTVIEWW,
			nullptr,
			WS_CHILD | WS_VISIBLE | LVS_REPORT | LVS_SINGLESEL | LVS_SHOWSELALWAYS,
			0,
			0,
			0,
			0,
			hWnd,
			(HMENU)IDC_LIST,
			(HINSTANCE)GetWindowLongPtrW(hWnd, GWLP_HINSTANCE),
			nullptr);
		SendMessageW(hList, WM_SETFONT, (WPARAM)GetStockObject(DEFAULT_GUI_FONT), TRUE);
		ListView_SetExtendedListViewStyle(hList, LVS_EX_FULLROWSELECT | LVS_EX_GRIDLINES);
		listview_insert_columns(hList);

		layout_controls(hWnd);
		return 0;
	}
	case WM_SIZE:
		layout_controls(hWnd);
		return 0;
	case WM_COMMAND:
		if (LOWORD(wParam) == IDC_ANALYZE) {
			do_analyze(hWnd);
			return 0;
		}
		break;
	case WM_DESTROY:
		PostQuitMessage(0);
		return 0;
	}
	return DefWindowProcW(hWnd, msg, wParam, lParam);
}

extern "C" int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE, PWSTR, int nCmdShow) {
	INITCOMMONCONTROLSEX icc{};
	icc.dwSize = sizeof(icc);
	icc.dwICC = ICC_LISTVIEW_CLASSES;
	InitCommonControlsEx(&icc);

	WNDCLASSEXW wc{};
	wc.cbSize = sizeof(wc);
	wc.hInstance = hInst;
	wc.lpszClassName = kWindowClass;
	wc.lpfnWndProc = WndProc;
	wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
	wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
	wc.style = CS_HREDRAW | CS_VREDRAW;
	RegisterClassExW(&wc);

	HWND hWnd = CreateWindowExW(
		0,
		kWindowClass,
		L"Analizador Léxico (FLEX) — mi mini gramática",
		WS_OVERLAPPEDWINDOW,
		CW_USEDEFAULT,
		CW_USEDEFAULT,
		900,
		650,
		nullptr,
		nullptr,
		hInst,
		nullptr);

	ShowWindow(hWnd, nCmdShow);
	UpdateWindow(hWnd);

	MSG msg;
	while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
		TranslateMessage(&msg);
		DispatchMessageW(&msg);
	}
	return 0;
}
