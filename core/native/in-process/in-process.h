#pragma once
#include <stdint.h>
#include <Windows.h>

typedef void (*CaptureCallbackPtr)(const wchar_t *envBlock, size_t byteSize);
typedef void (*EventFuncPtr)(UINT msg, UINT wParam, LONG lParam);
typedef void (*VisibilityEventFuncPtr)(int isVisible);

extern "C" __declspec(dllexport) int Init(CaptureCallbackPtr onReady, EventFuncPtr onEvents, VisibilityEventFuncPtr onVisibility);
extern "C" __declspec(dllexport) bool Ready();
extern "C" __declspec(dllexport) bool GetFrame(uint8_t* buffer, uint32_t* sizeOut, uint32_t* wOut, uint32_t* hOut);
extern "C" __declspec(dllexport) void FreeFrameBuffer(uint8_t* buffer);
extern "C" __declspec(dllexport) void HideTargetWindow();
extern "C" __declspec(dllexport) void ShowTargetWindow();
extern "C" __declspec(dllexport) void ClickWindowAt(int x, int y);
extern "C" __declspec(dllexport) void ClickRawWindowAt(int clientX, int clientY);
extern "C" __declspec(dllexport) void ResizeWindow(int width, int height);
extern "C" __declspec(dllexport) void TypeWindow(const wchar_t* text);
extern "C" __declspec(dllexport) void NativeClientToScreen(HWND hwnd, POINT* pt);
extern "C" __declspec(dllexport) void CloseTargetWindow();
