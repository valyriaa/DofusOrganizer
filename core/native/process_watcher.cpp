
#define WIN32_NO_STATUS
#include <napi.h>
#include <windows.h>
#include <tlhelp32.h>
#include <string>
#include <thread>
#include <iostream>
#include <winternl.h>
#include <vector>
#include <map>
#include <iostream>
#include <basetsd.h>
#include <set>

static std::string g_logPath;

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

    g_logPath = std::string(exePath) + "capture_log_mod.txt";
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

class ProcessWatcherWorker : public Napi::AsyncWorker
{
public:
    ProcessWatcherWorker(const std::wstring &targetName, Napi::Function &callback)
        : Napi::AsyncWorker(callback), targetName_(targetName), pid_(0), cancelled_(false)
    {
        tsfn_ = Napi::ThreadSafeFunction::New(
            Env(),
            callback,
            "process-watcher",
            0,
            1);
    }

    ~ProcessWatcherWorker()
    {
        tsfn_.Release();
    }

    void Execute() override
    {
        log("waiting process...");

        while (!cancelled_)
        {
            HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snapshot == INVALID_HANDLE_VALUE)
            {
                Sleep(200);
                continue;
            }

            std::vector<DWORD> matches;
            PROCESSENTRY32W entry;
            entry.dwSize = sizeof(entry);

            if (Process32FirstW(snapshot, &entry))
            {
                do
                {
                    if (_wcsicmp(targetName_.c_str(), entry.szExeFile) == 0)
                    {
                        matches.push_back(entry.th32ProcessID);
                    }
                } while (Process32NextW(snapshot, &entry));
            }

            CloseHandle(snapshot);

            for (DWORD pid : matches)
            {
                if (cancelled_)
                    break;

                if (seen_.count(pid))
                    continue;

                seen_.insert(pid);

                log("found process %u", pid);

                HANDLE hThreadSnap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
                if (hThreadSnap == INVALID_HANDLE_VALUE)
                {
                    log("failed to create thread snapshot for pid %u", pid);
                    continue;
                }

                bool suspendedAny = false;
                THREADENTRY32 te;
                te.dwSize = sizeof(te);

                log("suspending threads for pid %u", pid);

                if (Thread32First(hThreadSnap, &te))
                {
                    do
                    {
                        if (te.th32OwnerProcessID == pid)
                        {
                            HANDLE hThread = OpenThread(THREAD_SUSPEND_RESUME, FALSE, te.th32ThreadID);
                            if (hThread)
                            {
                                if (SuspendThread(hThread) != (DWORD)-1)
                                {
                                    suspendedAny = true;
                                }
                                CloseHandle(hThread);
                            }
                        }
                    } while (Thread32Next(hThreadSnap, &te));
                }

                CloseHandle(hThreadSnap);

                log("thread suspended for pid %u: %d", pid, suspendedAny ? 1 : 0);

                if (suspendedAny)
                {
                    DWORD *pPid = new DWORD(pid);
                    tsfn_.NonBlockingCall(pPid, [](Napi::Env env, Napi::Function jsCallback, DWORD *pidPtr)
                                          {
                    jsCallback.Call({env.Null(), Napi::Number::New(env, *pidPtr)});
                    delete pidPtr; });
                }
            }

            Sleep(200);
        }
    }

    void OnOK() override
    {
        log("listening stopped.");
    }

    void Cancel()
    {
        cancelled_ = true;
        try
        {
            tsfn_.Release();
        }
        catch (...) {}
        log("listening stopped (cancelled).");
        SetError("cancelled");
    }

    void OnError(const Napi::Error &e) override
    {
        if (std::string(e.Message()) == "cancelled")
        {
            Callback().Call({Napi::Error::New(Env(), "Watcher aborted").Value(), Env().Undefined()});
            return;
        }
        Callback().Call({e.Value(), Env().Undefined()});
    }

private:
    std::wstring targetName_;
    DWORD pid_;
    Napi::ThreadSafeFunction tsfn_;
    std::set<DWORD> seen_;
    bool cancelled_;
    std::map<std::wstring, std::wstring> env_;
};

Napi::Value WaitForProcessJS(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 3 || !info[0].IsString() || !info[1].IsFunction())
    {
        Napi::TypeError::New(env, "Expected process name, callback, and signal").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string target = info[0].As<Napi::String>().Utf8Value();
    std::wstring wtarget(target.begin(), target.end());
    Napi::Function cb = info[1].As<Napi::Function>();
    Napi::Value signal = info[2];

    ProcessWatcherWorker *worker = new ProcessWatcherWorker(wtarget, cb);

    if (signal.IsObject())
    {
        Napi::Object signalObj = signal.As<Napi::Object>();
        Napi::Function onAbort = Napi::Function::New(env, [worker](const Napi::CallbackInfo &info)
                                                     { worker->Cancel(); });
        signalObj.Get("addEventListener").As<Napi::Function>().Call(signalObj, {Napi::String::New(env, "abort"), onAbort});
    }

    worker->Queue();
    return env.Undefined();
}

Napi::Value ResumeProcess(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber())
    {
        Napi::TypeError::New(env, "pid expected").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    DWORD pid = static_cast<DWORD>(info[0].As<Napi::Number>().Uint32Value());

    HANDLE hThreadSnap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (hThreadSnap == INVALID_HANDLE_VALUE)
        return env.Undefined();

    THREADENTRY32 te;
    te.dwSize = sizeof(te);

    if (Thread32First(hThreadSnap, &te))
    {
        do
        {
            if (te.th32OwnerProcessID == pid)
            {
                HANDLE hThread = OpenThread(THREAD_SUSPEND_RESUME, FALSE, te.th32ThreadID);
                if (hThread)
                {
                    while (ResumeThread(hThread) > 0)
                        ;
                    CloseHandle(hThread);
                }
            }
        } while (Thread32Next(hThreadSnap, &te));
    }

    CloseHandle(hThreadSnap);
    return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("WaitForProcess", Napi::Function::New(env, WaitForProcessJS));
    exports.Set("ResumeProcess", Napi::Function::New(env, ResumeProcess));
    return exports;
}

NODE_API_MODULE(process_watcher, Init);
