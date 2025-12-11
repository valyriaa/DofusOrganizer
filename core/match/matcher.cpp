
#define WIN32_LEAN_AND_MEAN
#include <napi.h>
#include <opencv2/opencv.hpp>
#include <thread>
#include <vector>
#include <mutex>
#include <atomic>
#include <string>
#include <array>
#include <cmath>

static std::mutex g_tplMutex;
static bool g_templatesLoaded = false;
static int g_loadMargin = 20;

struct TemplateEntry
{
    std::string id;
    cv::Mat color;
    std::array<cv::Mat, 3> ch;
    int w = 0;
    int h = 0;
    cv::Rect rawRect = cv::Rect();
    bool hasRect = false;
    cv::Mat hsvHist;
};
static std::vector<TemplateEntry> g_templates;

static cv::Mat bufToBGRMatCopy(const uint8_t *d, int w, int h)
{
    cv::Mat tmpRGBA(h, w, CV_8UC4);
    std::memcpy(tmpRGBA.data, d, (size_t)w * (size_t)h * 4);
    cv::Mat out;
    cv::cvtColor(tmpRGBA, out, cv::COLOR_RGBA2BGR);
    return out;
}

static cv::Mat computeHSVHist(const cv::Mat &colorTemplate)
{
    cv::Mat hsv;
    cv::cvtColor(colorTemplate, hsv, cv::COLOR_BGR2HSV);
    int hBins = 16, sBins = 4;
    int histSize[] = {hBins, sBins};
    float hRanges[] = {0, 180}, sRanges[] = {0, 256};
    const float *ranges[] = {hRanges, sRanges};
    int channels[] = {0, 1};
    cv::Mat hist;
    cv::calcHist(&hsv, 1, channels, cv::Mat(), hist, 2, histSize, ranges, true, false);
    if (cv::sum(hist)[0] > 0.0)
        cv::normalize(hist, hist, 1.0, 0.0, cv::NORM_L1);
    return hist;
}

static cv::Rect expandRectClamped(const cv::Rect &r, int margin, int frameW, int frameH)
{
    int x = std::max(0, r.x - margin);
    int y = std::max(0, r.y - margin);
    int right = std::min(frameW, r.x + r.width + margin);
    int bottom = std::min(frameH, r.y + r.height + margin);
    return cv::Rect(x, y, std::max(0, right - x), std::max(0, bottom - y));
}

Napi::Value loadTemplatesWrapped(const Napi::CallbackInfo &ci)
{
    Napi::Env env = ci.Env();
    if (ci.Length() < 1 || !ci[0].IsObject())
    {
        Napi::TypeError::New(env, "object expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object opts = ci[0].As<Napi::Object>();
    if (!opts.Has("templates") || !opts.Get("templates").IsArray())
    {
        Napi::TypeError::New(env, "array expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (opts.Has("margin") && opts.Get("margin").IsNumber())
    {
        int m = opts.Get("margin").As<Napi::Number>().Int32Value();
        if (m < 0)
            m = 0;
        {
            std::lock_guard<std::mutex> lk(g_tplMutex);
            g_loadMargin = m;
        }
    }

    Napi::Array tpls = opts.Get("templates").As<Napi::Array>();
    std::vector<TemplateEntry> tmp;
    tmp.reserve(tpls.Length());

    for (uint32_t i = 0; i < tpls.Length(); ++i)
    {
        Napi::Value v = tpls.Get(i);
        if (!v.IsObject())
            continue;
        Napi::Object t = v.As<Napi::Object>();

        if (!t.Has("buf") || !t.Has("w") || !t.Has("h") || !t.Has("id"))
            continue;

        Napi::Buffer<uint8_t> tb = t.Get("buf").As<Napi::Buffer<uint8_t>>();
        int tw = t.Get("w").As<Napi::Number>().Int32Value();
        int th = t.Get("h").As<Napi::Number>().Int32Value();
        std::string id = t.Get("id").As<Napi::String>().Utf8Value();

        cv::Mat color = bufToBGRMatCopy(tb.Data(), tw, th);

        cv::Rect rect(0, 0, 0, 0);
        bool hasRect = false;
        if (t.Has("rect") && t.Get("rect").IsObject())
        {
            Napi::Object r = t.Get("rect").As<Napi::Object>();
            int rx = r.Has("x") ? r.Get("x").As<Napi::Number>().Int32Value() : 0;
            int ry = r.Has("y") ? r.Get("y").As<Napi::Number>().Int32Value() : 0;
            int rw = r.Has("width") ? r.Get("width").As<Napi::Number>().Int32Value() : 0;
            int rh = r.Has("height") ? r.Get("height").As<Napi::Number>().Int32Value() : 0;
            if (rw > 0 && rh > 0)
            {
                rect = cv::Rect(rx, ry, std::max(0, rw), std::max(0, rh));
                hasRect = true;
            }
        }

        TemplateEntry e;
        e.id = id;
        e.color = color;
        e.w = color.cols;
        e.h = color.rows;
        e.rawRect = rect;
        e.hasRect = hasRect;

        std::vector<cv::Mat> chVec;
        cv::split(color, chVec);
        for (int c = 0; c < 3; ++c)
            e.ch[c] = chVec[c].clone();

        e.hsvHist = computeHSVHist(color);

        tmp.push_back(std::move(e));
    }

    {
        std::lock_guard<std::mutex> lk(g_tplMutex);
        g_templates = std::move(tmp);
        g_templatesLoaded = true;
    }

    return Napi::Number::New(env, (double)g_templates.size());
}

class TemplateMatchWorker : public Napi::AsyncWorker
{
public:
    TemplateMatchWorker(
        Napi::Function &cb,
        cv::Mat frameColor,
        int method,
        std::array<float, 3> channelWeights,
        double histThreshold,
        std::vector<std::string> tplIds)
        : Napi::AsyncWorker(cb),
          frameColor_(std::move(frameColor)),
          method_(method),
          channelWeights_(channelWeights),
          histThreshold_(histThreshold),
          tplIds_(std::move(tplIds))
    {
        float s = channelWeights_[0] + channelWeights_[1] + channelWeights_[2];
        if (s > 0.0f)
        {
            channelWeights_[0] /= s;
            channelWeights_[1] /= s;
            channelWeights_[2] /= s;
        }
        else
        {
            channelWeights_ = {1.f / 3.f, 1.f / 3.f, 1.f / 3.f};
        }
    }

    void Execute() override
    {
        std::lock_guard<std::mutex> lk(g_tplMutex);
        if (!g_templatesLoaded || g_templates.empty())
            return;

        cv::Mat frameBlur;
        cv::GaussianBlur(frameColor_, frameBlur, cv::Size(3, 3), 0.5);

        std::array<cv::Mat, 3> frameCh;
        {
            std::vector<cv::Mat> tmp;
            cv::split(frameBlur, tmp);
            for (int c = 0; c < 3; ++c)
                frameCh[c] = tmp[c];
        }

        const int frameW = frameBlur.cols;
        const int frameH = frameBlur.rows;
        const size_t tplCount = g_templates.size();
        results_.resize(tplCount);

        unsigned hw = std::thread::hardware_concurrency();
        unsigned threadCount = std::max(1u, (hw == 0 ? 2u : hw / 2));
        if (threadCount > tplCount)
            threadCount = (unsigned)tplCount;

        std::vector<std::thread> threads(threadCount);
        std::atomic<size_t> nextIndex(0);

        auto workerFunc = [&](int threadId)
        {
            thread_local cv::Mat resAccum, tmpRes;

            size_t idx;
            while ((idx = nextIndex.fetch_add(1)) < tplCount)
            {
                const TemplateEntry &tpl = g_templates[idx];

                cv::Rect searchR;
                if (tpl.hasRect)
                {
                    searchR = expandRectClamped(tpl.rawRect, g_loadMargin, frameW, frameH);
                    if (searchR.width <= 0 || searchR.height <= 0)
                        searchR = cv::Rect(0, 0, frameW, frameH);
                }
                else
                {
                    searchR = cv::Rect(0, 0, frameW, frameH);
                }

                if (tpl.w > searchR.width || tpl.h > searchR.height)
                {
                    results_[idx] = {0, 0, 0.0};
                    continue;
                }

                std::array<cv::Mat, 3> roiCh;
                for (int c = 0; c < 3; ++c)
                    roiCh[c] = frameCh[c](searchR);

                cv::Size resSz(roiCh[0].cols - tpl.w + 1,
                               roiCh[0].rows - tpl.h + 1);

                if (resSz.width <= 0 || resSz.height <= 0)
                {
                    results_[idx] = {0, 0, 0.0};
                    continue;
                }

                if (resAccum.empty() || resAccum.size() != resSz)
                    resAccum.create(resSz, CV_32FC1);

                resAccum.setTo(0.0f);

                for (int c = 0; c < 3; ++c)
                {
                    if (channelWeights_[c] == 0.0f)
                        continue;

                    if (tmpRes.empty() || tmpRes.size() != resSz)
                        tmpRes.create(resSz, CV_32FC1);

                    cv::matchTemplate(roiCh[c], tpl.ch[c], tmpRes, method_);
                    cv::add(resAccum, tmpRes * channelWeights_[c], resAccum);
                }

                double minVal = 0.0, maxVal = 0.0;
                cv::Point minLoc, maxLoc;
                cv::minMaxLoc(resAccum, &minVal, &maxVal, &minLoc, &maxLoc);

                int bestX = searchR.x + maxLoc.x;
                int bestY = searchR.y + maxLoc.y;

                if (tpl.hasRect && !tpl.hsvHist.empty())
                {
                    cv::Rect matchedRect(bestX, bestY, tpl.w, tpl.h);

                    matchedRect &= cv::Rect(0, 0, frameW, frameH);

                    if (matchedRect.width > 0 && matchedRect.height > 0)
                    {
                        cv::Mat matchedColor = frameBlur(matchedRect);
                        cv::Mat matchedHist = computeHSVHist(matchedColor);

                        if (!matchedHist.empty())
                        {
                            double dist = cv::compareHist(
                                tpl.hsvHist, matchedHist, cv::HISTCMP_BHATTACHARYYA);

                            if (dist > histThreshold_)
                            {
                                results_[idx] = {0, 0, 0.0};
                                continue;
                            }
                        }
                    }
                }

                results_[idx] = {bestX + tpl.w / 2,bestY + tpl.h / 2,maxVal};
            }
        };

        for (unsigned t = 0; t < threadCount; ++t)
            threads[t] = std::thread(workerFunc, (int)t);
        for (unsigned t = 0; t < threadCount; ++t)
            if (threads[t].joinable())
                threads[t].join();
    }

    void OnOK() override
    {
        Napi::Env env = Env();
        Napi::HandleScope scope(env);
        Napi::Array outArr = Napi::Array::New(env, results_.size());
        for (size_t i = 0; i < results_.size(); ++i)
        {
            Napi::Object r = Napi::Object::New(env);
            std::string id = (i < tplIds_.size()) ? tplIds_[i] : std::string();
            r.Set("id", Napi::String::New(env, id));
            r.Set("x", Napi::Number::New(env, results_[i].x));
            r.Set("y", Napi::Number::New(env, results_[i].y));
            r.Set("score", Napi::Number::New(env, results_[i].score));
            outArr.Set((uint32_t)i, r);
        }
        Callback().Call({env.Null(), outArr});
    }

private:
    struct Result
    {
        int x;
        int y;
        double score;
    };
    std::vector<Result> results_;
    cv::Mat frameColor_;
    int method_;
    std::array<float, 3> channelWeights_;
    double histThreshold_;
    std::vector<std::string> tplIds_;
};

Napi::Value findTemplatesAsyncWrapped(const Napi::CallbackInfo &ci)
{
    Napi::Env env = ci.Env();
    if (ci.Length() < 2 || !ci[0].IsObject() || !ci[1].IsFunction())
    {
        Napi::TypeError::New(env, "callback expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object opts = ci[0].As<Napi::Object>();
    Napi::Function cb = ci[1].As<Napi::Function>();

    if (!opts.Has("frameBuffer") || !opts.Has("frameWidth") || !opts.Has("frameHeight"))
    {
        Napi::TypeError::New(env, "missing opts frameBuffer, frameWidth, frameHeight").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Buffer<uint8_t> fb = opts.Get("frameBuffer").As<Napi::Buffer<uint8_t>>();
    int fw = opts.Get("frameWidth").As<Napi::Number>().Int32Value();
    int fh = opts.Get("frameHeight").As<Napi::Number>().Int32Value();

    int method = cv::TM_CCOEFF_NORMED;
    if (opts.Has("method") && opts.Get("method").IsNumber())
        method = opts.Get("method").As<Napi::Number>().Int32Value();

    std::array<float, 3> channelWeights = {0.33f, 0.33f, 0.34f};
    if (opts.Has("channelWeights") && opts.Get("channelWeights").IsArray())
    {
        Napi::Array arr = opts.Get("channelWeights").As<Napi::Array>();
        for (uint32_t i = 0; i < 3 && i < arr.Length(); ++i)
            if (arr.Get(i).IsNumber())
                channelWeights[i] = (float)arr.Get(i).As<Napi::Number>().DoubleValue();
    }

    double histThreshold = 0.6;
    if (opts.Has("histThreshold") && opts.Get("histThreshold").IsNumber())
        histThreshold = opts.Get("histThreshold").As<Napi::Number>().DoubleValue();

    cv::Mat frameColor = bufToBGRMatCopy(fb.Data(), fw, fh);

    std::vector<std::string> tplIdsCopy;
    {
        std::lock_guard<std::mutex> lk(g_tplMutex);
        tplIdsCopy.reserve(g_templates.size());
        for (const auto &t : g_templates)
            tplIdsCopy.push_back(t.id);
    }

    auto *worker = new TemplateMatchWorker(cb, frameColor, method, channelWeights, histThreshold, std::move(tplIdsCopy));
    worker->Queue();

    return env.Undefined();
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports)
{
    exports.Set("loadTemplates", Napi::Function::New(env, loadTemplatesWrapped));
    exports.Set("findTemplatesAsync", Napi::Function::New(env, findTemplatesAsyncWrapped));
    return exports;
}

NODE_API_MODULE(matcher, InitAll);
