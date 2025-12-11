#define WINVER 0x0602
#define _WIN32_WINNT 0x0602

#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>
#include <dxgi1_2.h>
#include <vector>
#include <mutex>
#include <iostream>
#include "MinHook.h"
#include <cstdio>
#include <string>
#include <dxgi1_4.h>
#include <d3d12.h>
#include <algorithm>
#include <tlhelp32.h>
#include <functional>
#include <windowsx.h>
#include <vector>
#include <map>
#include <wrl.h>
#include <cstdint>

using Microsoft::WRL::ComPtr;

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")

template <typename T>
inline void SAFE_RELEASE_PTR(T *&p)
{
    if (p)
    {
        p->Release();
        p = nullptr;
    }
}

#define SAFE_RELEASE(x) \
    if (x)              \
    {                   \
        (x)->Release(); \
        (x) = nullptr;  \
    }

typedef HRESULT(__stdcall *PresentFn)(IDXGISwapChain *, UINT, UINT);
typedef HRESULT(__stdcall *CreateSwapChainFn)(IDXGIFactory *, IUnknown *, DXGI_SWAP_CHAIN_DESC *, IDXGISwapChain **);
typedef HRESULT(__stdcall *CreateSwapChain1Fn)(IDXGIFactory1 *, IUnknown *, DXGI_SWAP_CHAIN_DESC1 *, IDXGISwapChain1 **);
typedef HRESULT(__stdcall *CreateSwapChainForHwndFn)(IDXGIFactory2 *, IUnknown *, HWND, DXGI_SWAP_CHAIN_DESC1 *, DXGI_SWAP_CHAIN_FULLSCREEN_DESC *, IDXGIOutput *, IDXGISwapChain1 **);

struct CaptureResult
{
    uint8_t *buffer = nullptr;
    uint32_t size = 0;
    uint32_t width = 0;
    uint32_t height = 0;
    uint32_t rowPitch = 0;
};

class D3D12FrameGrabber
{
public:
    D3D12FrameGrabber() = default;
    ~D3D12FrameGrabber() { Shutdown(); }

    bool Init(IDXGISwapChain *swapchain);

    bool Capture(uint8_t **outBuffer, uint32_t *sizeOut, uint32_t *wOut, uint32_t *hOut, uint32_t *pOut, UINT timeoutMs = 5000);

    void Shutdown();

private:
    IDXGISwapChain *m_swapchain = nullptr;
    ComPtr<ID3D12Device> m_device;
    ComPtr<ID3D12CommandQueue> m_cmdQueue;
    ComPtr<ID3D12CommandAllocator> m_cmdAlloc;
    ComPtr<ID3D12GraphicsCommandList> m_cmdList;
    ComPtr<ID3D12Fence> m_fence;
    HANDLE m_fenceEvent = nullptr;
    UINT64 m_fenceValue = 1;
    ComPtr<ID3D12Resource> m_readback;
    UINT64 m_readbackSize = 0;
    UINT32 m_rowPitch = 0;
    UINT32 m_width = 0;
    UINT32 m_height = 0;
    D3D12_PLACED_SUBRESOURCE_FOOTPRINT m_footprint = {};
    UINT m_numRows = 0;
};

static std::string g_logPath;
static RECT g_originalRect;
static LONG_PTR g_originalExStyle = 0;
static BYTE g_originalAlpha = 255;
static bool g_saved = false;

WNDPROC g_originalWndProc = nullptr;

static IDXGISwapChain *g_swapchain = nullptr;
static ID3D11Device *g_device = nullptr;
static ID3D11DeviceContext *g_context = nullptr;
static std::vector<uint8_t> g_frame;
static uint32_t g_w = 0, g_h = 0;
static std::mutex g_lock;
static std::map<std::wstring, std::wstring> envMap;

PresentFn oPresent = nullptr;
HWND oHwnd = nullptr;

typedef void (*CaptureCallbackPtr)(const wchar_t *envBlock, size_t byteSize);
typedef void (*EventFuncPtr)(UINT msg, UINT wParam, LONG lParam);
typedef void (*VisibilityEventFuncPtr)(int isVisible);

CaptureCallbackPtr captureCallbackPtr = nullptr;
EventFuncPtr inputEventFuncPtr = nullptr;
VisibilityEventFuncPtr visibilityEventFuncPtr = nullptr;

// IDXGIFactory
CreateSwapChainFn oCreateSwapChain = nullptr;
// IDXGIFactory1
CreateSwapChain1Fn oCreateSwapChain1 = nullptr;
// IDXGIFactory2
CreateSwapChainForHwndFn oCreateSwapChainForHwnd = nullptr;

D3D12FrameGrabber g_grabber;

static void initLogPath()
{
    if (!g_logPath.empty())
        return;

    char exePath[MAX_PATH]{};
    GetModuleFileNameA(NULL, exePath, MAX_PATH);

    for (int i = (int)strlen(exePath) - 1; i >= 0; --i)
    {
        if (exePath[i] == '\\' || exePath[i] == '/')
        {
            exePath[i + 1] = 0;
            break;
        }
    }

    g_logPath = std::string(exePath) + "capture_log.txt";
}

void log(const char *fmt, ...)
{
    initLogPath();

    FILE *f = fopen(g_logPath.c_str(), "a");
    if (!f)
        return;

    va_list args;
    va_start(args, fmt);
    vfprintf(f, fmt, args);
    va_end(args);

    fprintf(f, "\n");
    fclose(f);
}

void LogLastError(const char *prefix)
{
    DWORD e = GetLastError();
    if (e == 0)
    {
        log("%s: lastErr() == 0\n", prefix);
        return;
    }
    char buf[256];
    FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                   nullptr, e, 0, buf, sizeof(buf), nullptr);
    log("%s: lastErr() = %u -> %s\n", prefix, (unsigned)e, buf);
}

LRESULT CALLBACK MyWndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    if (
        msg == WM_LBUTTONDOWN ||
        msg == WM_KEYDOWN ||
        msg == WM_SYSKEYDOWN ||
        msg == WM_CHAR ||
        msg == WM_SYSCHAR)
    {
        if (inputEventFuncPtr != nullptr && inputEventFuncPtr != NULL)
        {
            inputEventFuncPtr(msg, wParam, lParam);
        }
    }
    return CallWindowProc(g_originalWndProc, hWnd, msg, wParam, lParam);
}

bool ReadLocalEnvironment(std::map<std::wstring, std::wstring> &envOut)
{
    LPWCH envBlock = GetEnvironmentStringsW();
    if (!envBlock)
    {
        return false;
    }

    LPWCH p = envBlock;
    while (*p)
    {
        std::wstring pair(p);
        if (!pair.empty())
        {
            size_t pos = pair.find(L'=');
            if (pos != std::wstring::npos)
            {
                envOut[pair.substr(0, pos)] = pair.substr(pos + 1);
            }
        }
        p += pair.length() + 1;
    }

    FreeEnvironmentStringsW(envBlock);
    return true;
}

bool D3D12FrameGrabber::Init(IDXGISwapChain *swapchain)
{
    if (!swapchain)
        return false;

    log("grabber init...");

    HRESULT hr_dev = S_OK;
    ID3D12Resource *back = nullptr;

    hr_dev = swapchain->GetBuffer(0, __uuidof(ID3D12Resource), (void **)&back);
    if (FAILED(hr_dev) || !back)
    {
        log("getBuffer failed: 0x%08X", (unsigned)hr_dev);
        SAFE_RELEASE_PTR(back);
        return false;
    }

    ID3D12Device *device = nullptr;
    back->GetDevice(__uuidof(ID3D12Device), (void **)&device);
    if (!device)
    {
        log("back->GetDevice failed");
        SAFE_RELEASE(back);
        return false;
    }

    m_device = device;
    m_swapchain = swapchain;

    D3D12_COMMAND_QUEUE_DESC qdesc = {};
    qdesc.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
    qdesc.Priority = D3D12_COMMAND_QUEUE_PRIORITY_NORMAL;
    qdesc.Flags = D3D12_COMMAND_QUEUE_FLAG_NONE;
    qdesc.NodeMask = 0;

    HRESULT hr = m_device->CreateCommandQueue(&qdesc, IID_PPV_ARGS(&m_cmdQueue));
    if (FAILED(hr))
    {
        m_cmdQueue = nullptr;
        return false;
    }

    hr = m_device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&m_cmdAlloc));
    if (FAILED(hr))
    {
        return false;
    }

    hr = m_device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, m_cmdAlloc.Get(), nullptr, IID_PPV_ARGS(&m_cmdList));
    if (FAILED(hr))
    {
        return false;
    }

    m_cmdList->Close();

    hr = m_device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&m_fence));
    if (FAILED(hr))
    {
        return false;
    }

    m_fenceEvent = CreateEvent(nullptr, FALSE, FALSE, nullptr);
    if (!m_fenceEvent)
    {
        return false;
    }

    m_fenceValue = 1;
    m_readbackSize = 0;
    m_readback = nullptr;

    return true;
}

void D3D12FrameGrabber::Shutdown()
{
    if (m_fence && m_fenceEvent)
    {
        UINT64 val = ++m_fenceValue;
        if (m_cmdQueue)
            m_cmdQueue->Signal(m_fence.Get(), val);
        if (m_fence->GetCompletedValue() < val)
        {
            m_fence->SetEventOnCompletion(val, m_fenceEvent);
            WaitForSingleObject(m_fenceEvent, 200);
        }
    }

    if (m_fenceEvent)
    {
        CloseHandle(m_fenceEvent);
        m_fenceEvent = nullptr;
    }

    m_readback.Reset();
    m_cmdList.Reset();
    m_cmdAlloc.Reset();
    m_cmdQueue.Reset();
    m_fence.Reset();
    m_device.Reset();
    m_swapchain = nullptr;
}

bool D3D12FrameGrabber::Capture(uint8_t **outBuffer, uint32_t *sizeOut, uint32_t *wOut, uint32_t *hOut, uint32_t *pOut, UINT timeoutMs)
{
    if (!m_device || !m_swapchain || !m_cmdQueue || !m_cmdAlloc || !m_cmdList || !m_fence || !m_fenceEvent)
        return false;

    HRESULT hr = S_OK;
    ID3D12Resource *back = nullptr;

    hr = m_swapchain->GetBuffer(0, __uuidof(ID3D12Resource), (void **)&back);
    if (FAILED(hr) || !back)
    {
        log("Getbuff failed: 0x%08X", (unsigned)hr);
        SAFE_RELEASE_PTR(back);
        return false;
    }

    D3D12_RESOURCE_DESC desc = back->GetDesc();
    UINT32 w = static_cast<UINT32>(desc.Width);
    UINT32 h = static_cast<UINT32>(desc.Height);

    D3D12_RESOURCE_DESC copyDesc = desc;
    copyDesc.Dimension = D3D12_RESOURCE_DIMENSION_TEXTURE2D;

    D3D12_PLACED_SUBRESOURCE_FOOTPRINT footprint = {};
    UINT numRows = 0;
    UINT64 requiredSize = 0;
    UINT64 rowSizeInBytes = 0;
    m_device->GetCopyableFootprints(&copyDesc, 0, 1, 0, &footprint, &numRows, &rowSizeInBytes, &requiredSize);

    if (requiredSize != m_readbackSize || w != m_width || h != m_height)
    {
        D3D12_HEAP_PROPERTIES heapProps = {};
        heapProps.Type = D3D12_HEAP_TYPE_READBACK;
        heapProps.CPUPageProperty = D3D12_CPU_PAGE_PROPERTY_UNKNOWN;
        heapProps.MemoryPoolPreference = D3D12_MEMORY_POOL_UNKNOWN;
        heapProps.CreationNodeMask = 1;
        heapProps.VisibleNodeMask = 1;

        D3D12_RESOURCE_DESC bufferDesc = {};
        bufferDesc.Dimension = D3D12_RESOURCE_DIMENSION_BUFFER;
        bufferDesc.Alignment = 0;
        bufferDesc.Width = requiredSize;
        bufferDesc.Height = 1;
        bufferDesc.DepthOrArraySize = 1;
        bufferDesc.MipLevels = 1;
        bufferDesc.Format = DXGI_FORMAT_UNKNOWN;
        bufferDesc.SampleDesc.Count = 1;
        bufferDesc.Layout = D3D12_TEXTURE_LAYOUT_ROW_MAJOR;
        bufferDesc.Flags = D3D12_RESOURCE_FLAG_NONE;

        m_readback.Reset();
        hr = m_device->CreateCommittedResource(
            &heapProps,
            D3D12_HEAP_FLAG_NONE,
            &bufferDesc,
            D3D12_RESOURCE_STATE_COPY_DEST,
            nullptr,
            IID_PPV_ARGS(&m_readback));

        if (FAILED(hr) || !m_readback)
        {
            m_readbackSize = 0;
            return false;
        }

        m_readbackSize = requiredSize;
        m_footprint = footprint;
        m_numRows = numRows;
        m_rowPitch = static_cast<UINT32>(footprint.Footprint.RowPitch);
        m_width = w;
        m_height = h;
    }
    else
    {
        footprint = m_footprint;
        numRows = m_numRows;
        rowSizeInBytes = m_rowPitch;
    }

    m_cmdAlloc->Reset();
    m_cmdList->Reset(m_cmdAlloc.Get(), nullptr);

    D3D12_RESOURCE_BARRIER barrier = {};
    barrier.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
    barrier.Flags = D3D12_RESOURCE_BARRIER_FLAG_NONE;
    barrier.Transition.pResource = back;
    barrier.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
    barrier.Transition.StateBefore = D3D12_RESOURCE_STATE_PRESENT;
    barrier.Transition.StateAfter = D3D12_RESOURCE_STATE_COPY_SOURCE;
    m_cmdList->ResourceBarrier(1, &barrier);

    D3D12_TEXTURE_COPY_LOCATION srcLoc = {};
    srcLoc.pResource = back;
    srcLoc.Type = D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX;
    srcLoc.SubresourceIndex = 0;

    D3D12_TEXTURE_COPY_LOCATION dstLoc = {};
    dstLoc.pResource = m_readback.Get();
    dstLoc.Type = D3D12_TEXTURE_COPY_TYPE_PLACED_FOOTPRINT;
    dstLoc.PlacedFootprint = footprint;

    m_cmdList->CopyTextureRegion(&dstLoc, 0, 0, 0, &srcLoc, nullptr);

    D3D12_RESOURCE_BARRIER barrierEnd = barrier;
    barrierEnd.Transition.StateBefore = D3D12_RESOURCE_STATE_COPY_SOURCE;
    barrierEnd.Transition.StateAfter = D3D12_RESOURCE_STATE_PRESENT;
    m_cmdList->ResourceBarrier(1, &barrierEnd);

    m_cmdList->Close();

    ID3D12CommandList *lists[] = {m_cmdList.Get()};
    m_cmdQueue->ExecuteCommandLists(1, lists);

    UINT64 fenceToWait = ++m_fenceValue;
    hr = m_cmdQueue->Signal(m_fence.Get(), fenceToWait);
    if (FAILED(hr))
        return false;

    if (m_fence->GetCompletedValue() < fenceToWait)
    {
        hr = m_fence->SetEventOnCompletion(fenceToWait, m_fenceEvent);
        if (FAILED(hr))
            return false;
        WaitForSingleObject(m_fenceEvent, timeoutMs);
    }

    uint8_t *mapped = nullptr;
    D3D12_RANGE readRange = {0, static_cast<SIZE_T>(m_readbackSize)};
    hr = m_readback->Map(0, &readRange, reinterpret_cast<void **>(&mapped));
    if (FAILED(hr) || !mapped)
    {
        return false;
    }

    const size_t rowBytesTight = static_cast<size_t>(m_width) * 4;
    const size_t totalSize = rowBytesTight * (size_t)m_height;
    uint8_t *out = (uint8_t *)malloc(totalSize);
    if (!out)
    {
        m_readback->Unmap(0, nullptr);
        return false;
    }

    for (UINT32 y = 0; y < m_height; ++y)
    {
        uint8_t *srcRow = mapped + (size_t)y * m_rowPitch;
        uint8_t *dstRow = out + (size_t)y * rowBytesTight;
        memcpy(dstRow, srcRow, rowBytesTight);
    }

    D3D12_RANGE writtenRange = {0, 0};
    m_readback->Unmap(0, &writtenRange);

    if (outBuffer)
        *outBuffer = out;
    if (sizeOut)
        *sizeOut = (uint32_t)totalSize;
    if (wOut)
        *wOut = m_width;
    if (hOut)
        *hOut = m_height;
    if (pOut)
        *pOut = m_rowPitch;

    return true;
}

typedef HRESULT(WINAPI *PFN_D3D11CreateDevice)(
    IDXGIAdapter *,
    D3D_DRIVER_TYPE,
    HMODULE,
    UINT,
    const D3D_FEATURE_LEVEL *,
    UINT,
    UINT,
    ID3D11Device **,
    D3D_FEATURE_LEVEL *,
    ID3D11DeviceContext **);

typedef HRESULT(WINAPI *PFN_D3D11CreateDeviceAndSwapChain)(
    IDXGIAdapter *,
    D3D_DRIVER_TYPE,
    HMODULE,
    UINT,
    const D3D_FEATURE_LEVEL *,
    UINT,
    UINT,
    const DXGI_SWAP_CHAIN_DESC *,
    IDXGISwapChain **,
    ID3D11Device **,
    D3D_FEATURE_LEVEL *,
    ID3D11DeviceContext **);

PFN_D3D11CreateDevice oD3D11CreateDevice;
PFN_D3D11CreateDeviceAndSwapChain oD3D11CreateDeviceAndSwapChain;

HRESULT WINAPI hkD3D11CreateDevice(
    IDXGIAdapter *pAdapter,
    D3D_DRIVER_TYPE DriverType,
    HMODULE Software,
    UINT Flags,
    const D3D_FEATURE_LEVEL *pFeatureLevels,
    UINT FeatureLevels,
    UINT SDKVersion,
    ID3D11Device **ppDevice,
    D3D_FEATURE_LEVEL *pFeatureLevel,
    ID3D11DeviceContext **ppImmediateContext)
{
    HRESULT hr = oD3D11CreateDevice(
        pAdapter, DriverType, Software, Flags,
        pFeatureLevels, FeatureLevels, SDKVersion,
        ppDevice, pFeatureLevel, ppImmediateContext);

    if (SUCCEEDED(hr))
    {
        if (ppDevice && *ppDevice)
        {
            g_device = *ppDevice;
            log("Device %p\n", *ppDevice);
        }

        if (ppImmediateContext && *ppImmediateContext)
        {
            g_context = *ppImmediateContext;
            log("Context %p\n", *ppImmediateContext);
        }
    }

    return hr;
}

typedef HRESULT(WINAPI *PFN_CreateSwapChainForHwnd)(
    IDXGIFactory2 *,
    ID3D11Device *,
    HWND,
    const DXGI_SWAP_CHAIN_DESC1 *,
    const DXGI_SWAP_CHAIN_FULLSCREEN_DESC *,
    IDXGIOutput *,
    IDXGISwapChain1 **);

HRESULT WINAPI hkCreateSwapChainForHwnd(
    IDXGIFactory2 *factory,
    ID3D11Device *device,
    HWND hwnd,
    DXGI_SWAP_CHAIN_DESC1 *desc,
    DXGI_SWAP_CHAIN_FULLSCREEN_DESC *fsDesc,
    IDXGIOutput *restrictToOutput,
    IDXGISwapChain1 **ppSwapChain)
{
    log("[+] hkCreateSwapChainForHwnd fired");

    HRESULT hr = oCreateSwapChainForHwnd(
        factory, device, hwnd, desc, fsDesc, restrictToOutput, ppSwapChain);

    if (SUCCEEDED(hr) && ppSwapChain && *ppSwapChain)
    {
        g_swapchain = *ppSwapChain;
        g_swapchain->AddRef();
        oHwnd = hwnd;
        g_originalWndProc = (WNDPROC)
            SetWindowLongPtr(oHwnd, GWLP_WNDPROC, (LONG_PTR)MyWndProc);

        if (captureCallbackPtr != nullptr && captureCallbackPtr != NULL)
        {

            ReadLocalEnvironment(envMap);

            std::wstring block;
            for (auto &kv : envMap)
            {
                block.append(kv.first);
                block.push_back(L'=');
                block.append(kv.second);
                block.push_back(L'\0');
            }

            block.push_back(L'\0');
            captureCallbackPtr(block.c_str(), block.size() * sizeof(wchar_t));
        }

        g_grabber.Init(g_swapchain);

        log("[+] Swapchain captured %p", g_swapchain);
    }

    return hr;
}

extern "C" __declspec(dllexport) int Init(CaptureCallbackPtr readyCallback, EventFuncPtr EventFuncPtr, VisibilityEventFuncPtr visibilityFuncPtr)
{
    log("[Init] Begin\n");

    MH_STATUS st = MH_Initialize();
    if (st != MH_OK)
    {
        char buf[256];
        sprintf(buf, "[Init] MH_Initialize failed: %d\n", st);
        log(buf);
        return st;
    }

    HMODULE d3d11 = GetModuleHandleA("d3d11.dll");
    HMODULE dxgi = GetModuleHandleA("dxgi.dll");

    if (!d3d11)
        d3d11 = LoadLibraryA("d3d11.dll");

    if (!dxgi)
        dxgi = LoadLibraryA("dxgi.dll");

    if (!d3d11)
    {
        log("[Init] Failed to load d3d11.dll\n");
        return -10;
    }

    captureCallbackPtr = readyCallback;
    inputEventFuncPtr = EventFuncPtr;
    visibilityEventFuncPtr = visibilityFuncPtr;

    auto CreateDXGIFactory2 =
        (HRESULT(WINAPI *)(UINT, REFIID, void **))
            GetProcAddress(dxgi, "CreateDXGIFactory2");

    void *pDev = (void *)GetProcAddress(d3d11, "D3D11CreateDevice");
    void *pDevSC = (void *)GetProcAddress(d3d11, "D3D11CreateDeviceAndSwapChain");

    IDXGIFactory2 *factory = nullptr;
    if (SUCCEEDED(CreateDXGIFactory2(0, __uuidof(IDXGIFactory2), (void **)&factory)))
    {
        void **vtbl = *(void ***)factory;

        void *CreateSwapChainForHwnd_i = vtbl[15];

        MH_CreateHook(CreateSwapChainForHwnd_i, hkCreateSwapChainForHwnd,
                      (LPVOID *)&oCreateSwapChainForHwnd);

        MH_EnableHook(CreateSwapChainForHwnd_i);

        log("[+] Hooked CreateSwapChainForHwnd at %p", CreateSwapChainForHwnd_i);
    }

    if (!pDev || !pDevSC)
    {
        log("[Init] GetProcAddress failed\n");
        return -11;
    }

    st = MH_CreateHook(pDev, hkD3D11CreateDevice, (LPVOID *)&oD3D11CreateDevice);
    if (st != MH_OK)
    {
        char buf[256];
        sprintf(buf, "[Init] MH_CreateHook(Device) failed: %d\n", st);
        log(buf);
        return st;
    }

    st = MH_EnableHook(MH_ALL_HOOKS);
    if (st != MH_OK)
    {
        char buf[256];
        sprintf(buf, "[Init] MH_EnableHook failed: %d\n", st);
        log(buf);
        return st;
    }

    log("[Init] Hooks installed\n");

    return 1;
}

extern "C" __declspec(dllexport) bool IsReady()
{
    if (!g_swapchain || !g_device || !g_context)
    {
        log("g_swapchain or device or context is null");
        return false;
    }

    HRESULT hr = S_OK;
    ID3D12Resource *back = nullptr;

    hr = g_swapchain->GetBuffer(0, __uuidof(ID3D12Resource), (void **)&back);
    if (FAILED(hr) || !back)
    {
        log("GetBuffer(ID3D12Resource) failed: 0x%08X", (unsigned)hr);
        SAFE_RELEASE_PTR(back);
        return false;
    }

    ID3D12Device *device = nullptr;
    back->GetDevice(__uuidof(ID3D12Device), (void **)&device);
    if (!device)
    {
        log("back->GetDevice failed");
        SAFE_RELEASE_PTR(back);
        return false;
    }
    return true;
}

extern "C" __declspec(dllexport) bool GetFrame(uint8_t **buffer, uint32_t *sizeOut, uint32_t *wOut, uint32_t *hOut, uint32_t *pOut)
{
    std::lock_guard<std::mutex> guard(g_lock);
    if (!IsReady())
        return false;

    return g_grabber.Capture(buffer, sizeOut, wOut, hOut, pOut);
}

extern "C" __declspec(dllexport) void FreeFrameBuffer(uint8_t *buffer)
{
    if (buffer)
    {
        free(buffer);
    }
}

extern "C" __declspec(dllexport) void HideTargetWindow()
{
    if (!oHwnd)
        return;

    if (!g_saved)
    {
        GetWindowRect(oHwnd, &g_originalRect);
        g_originalExStyle = GetWindowLong(oHwnd, GWL_EXSTYLE);
        g_saved = true;
    }

    // ShowWindow(oHwnd, SW_MINIMIZE);

    LONG ex = GetWindowLong(oHwnd, GWL_EXSTYLE);
    ex &= ~WS_EX_APPWINDOW;
    ex |= WS_EX_TOOLWINDOW;
    ex |= WS_EX_LAYERED;
    ex &= ~WS_EX_TRANSPARENT;

    SetWindowLong(oHwnd, GWL_EXSTYLE, ex);

    SetLayeredWindowAttributes(oHwnd, 0, 0, LWA_ALPHA);

    SetWindowPos(oHwnd, HWND_BOTTOM, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED);

    visibilityEventFuncPtr(0);
}

extern "C" __declspec(dllexport) void ShowTargetWindow()
{
    if (!oHwnd || !g_originalExStyle)
        return;

    ShowWindow(oHwnd, SW_RESTORE);

    SetWindowLong(oHwnd, GWL_EXSTYLE, g_originalExStyle);
    SetLayeredWindowAttributes(oHwnd, 0, 255, LWA_ALPHA);

    SetWindowPos(oHwnd, HWND_TOPMOST, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);

    BringWindowToTop(oHwnd);
    SetFocus(oHwnd);

    visibilityEventFuncPtr(1);
}

extern "C" __declspec(dllexport) void TypeWindow(const wchar_t *text)
{
    if (!oHwnd || !text)
        return;

    for (const wchar_t *p = text; *p; p++)
    {
        wchar_t ch = *p;

        if (ch >= L' ' && ch != 0x7F)
        {
            PostMessage(oHwnd, WM_CHAR, (WPARAM)ch, 0);
        }
        else
        {
            SHORT vk = VkKeyScanW(ch);
            if (vk != -1)
            {
                BYTE key = LOBYTE(vk);

                PostMessage(oHwnd, WM_KEYDOWN, key, 0);
                PostMessage(oHwnd, WM_KEYUP, key, 0);
            }
        }
    }
}

extern "C" __declspec(dllexport) void ClickWindowAt(int clientX, int clientY)
{
    if (!oHwnd)
        return;

    POINT pt{clientX, clientY};
    // ClientToScreen(oHwnd, &pt);

    HWND target = ChildWindowFromPoint(oHwnd, pt);
    if (!target)
        target = oHwnd;

    LPARAM pos = MAKELPARAM(pt.x, pt.y);

    SendMessage(target, WM_MOUSEMOVE, 0, pos);
    SendMessage(target, WM_LBUTTONDOWN, MK_LBUTTON, pos);
    SendMessage(target, WM_LBUTTONUP, 0, pos);
}

extern "C" __declspec(dllexport) void ShowTargetWindow_ForInput()
{
    if (!oHwnd)
        return;

    LONG ex = GetWindowLong(oHwnd, GWL_EXSTYLE);

    ex |= WS_EX_LAYERED;
    ex &= ~WS_EX_TRANSPARENT;
    SetWindowLong(oHwnd, GWL_EXSTYLE, ex);

    SetLayeredWindowAttributes(oHwnd, 0, 2, LWA_ALPHA);

    SetWindowPos(
        oHwnd,
        HWND_TOPMOST,
        0, 0, 0, 0,
        SWP_NOMOVE |
            SWP_NOSIZE |
            SWP_NOACTIVATE |
            SWP_SHOWWINDOW);
}

extern "C" __declspec(dllexport) void ClickRawWindowAt(int clientX, int clientY, int hide)
{
    if (!oHwnd)
        return;

    POINT screen{};
    screen.x = clientX;
    screen.y = clientY;
    ClientToScreen(oHwnd, &screen);

    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);

    LONG absX = (screen.x * 65535) / (screenW - 1);
    LONG absY = (screen.y * 65535) / (screenH - 1);

    INPUT inputs[3] = {};

    inputs[0].type = INPUT_MOUSE;
    inputs[0].mi.dx = absX;
    inputs[0].mi.dy = absY;
    inputs[0].mi.dwFlags = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE;

    inputs[1].type = INPUT_MOUSE;
    inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;

    inputs[2].type = INPUT_MOUSE;
    inputs[2].mi.dwFlags = MOUSEEVENTF_LEFTUP;

    // SetWindowLong(oHwnd, GWL_EXSTYLE, g_originalExStyle);

    if (hide > 0)
        ShowTargetWindow_ForInput();

    SendInput(3, inputs, sizeof(INPUT));

    if (hide > 0)
        HideTargetWindow();
    else
        ShowTargetWindow();
}

extern "C" __declspec(dllexport) void CloseTargetWindow()
{
    if (!oHwnd)
        return;

    PostMessage(oHwnd, WM_CLOSE, 0, 0);
}

extern "C" __declspec(dllexport) void ResizeWindow(int width, int height)
{
    if (!oHwnd)
        return;

    RECT r;
    GetWindowRect(oHwnd, &r);

    int targetW = width;
    int targetH = height;

    SendMessage(oHwnd, WM_SYSCOMMAND, SC_SIZE + WMSZ_BOTTOMRIGHT, 0);
    Sleep(15);

    SetWindowPos(
        oHwnd,
        nullptr,
        r.left,
        r.top,
        targetW,
        targetH,
        SWP_NOZORDER | SWP_NOACTIVATE);

    Sleep(10);

    SendMessage(oHwnd, WM_EXITSIZEMOVE, 0, 0);
}
