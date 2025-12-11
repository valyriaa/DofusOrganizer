const events = require('events');
const fs = require('fs');
const path = require('path');
const Watcher = require('./native');
const { PNG } = require('pngjs');
const hookScript = require('./hook');

const REQ_TIMEOUT = 60 * 1000;
const READY_TIMEOUT = 2 * 60 * 1000;

var DLL_PATH;
if (process.isPackaged) {
    DLL_PATH = path.join(process.resourcesPath, "app.asar.unpacked", "in-process.dll")
}
else {
    DLL_PATH = path.join(__dirname, "native", "in-process", "build", "in-process.dll");
}

class DofusProcessChannel extends events.EventEmitter {

    #pid;
    #session;
    #script;
    #requests = new Map();
    #isReady;

    #captureFrame = true;
    #captureFrameListener;
    #lastCaptureFrame = null;
    #isVisible = true;

    static #mut = (function (max = 20) {
        const locks = new Map();

        return {
            async wait(key) {
                if (!locks.has(key)) {
                    locks.set(key, { task: Promise.resolve(), q: [] });
                }

                const lock = locks.get(key);

                if (lock.q.length >= max) {
                    throw new Error(`many concurrent locks on key "${key}"`);
                }

                let next;
                const obj = new Promise(resolve => {
                    next = resolve;
                });

                const prev = lock.task;

                lock.q.push(next);
                lock.task = lock.task.then(() => obj);

                await prev;

                return () => {
                    lock.q.shift();
                    next();
                    lock.q.length === 0 && locks.delete(key);
                };
            }
        };
    })()

    constructor(pid, session, script) {
        super();

        this.#pid = pid;
        this.#session = session;
        this.#script = script;

        this.#captureFrameListener = this.#onFrame.bind(this);

        this.#script.message.connect((message, buffer) => {
            if (message.type === "send") {
                const { type, id, error, ok, data, event, env, isVisible } = message.payload;
                if (type == "ready") {
                    this.#isReady = true;
                    this.emit("ready", env);
                    return;
                }
                else if (type == "visibility") {
                    this.#isVisible = isVisible == 1;
                    console.log('visibility changed to: ', this.#isVisible);
                }
                else if (type == "input_event") {
                    event && this.emit("input", this, event);
                }
                else if (type == "frame") {
                    const { width, height } = message.payload;
                    this.#captureFrameListener(buffer, width, height);
                }
                else {
                    const req = this.#requests.get(id);
                    if (!req) {
                        console.warn(`request id '${id}' was not found or timedout.`);
                        return;
                    }
                    !ok || error ? req.reject(new Error(error)) : req.resolve({ data, buffer });
                    console.info(`[${!ok || error ? "error" : "success"}] request '${id}' fullfilled.`)
                }
            }
        });

        this.#session.detached.connect(this.#clearRequests.bind(this, "detached"));
        this.#script.destroyed.connect(this.#clearRequests.bind(this, "destroyed"));
    }

    get pid() {
        return this.#pid;
    }

    get alive() {
        return !this.#session.isDetached() && !this.#script.isDestroyed;
    }

    get isReady() {
        return this.#isReady;
    }

    get frame() {
        return this.#lastCaptureFrame;
    }

    get isVisible() {
        return this.#isVisible;
    }

    toggleFrame(capture = false) {
        if (this.#captureFrame == capture) {
            return Promise.resolve();
        }
        return process("enableFrame", capture).then(() => {
            if (this.#captureFrame = capture) {
                this.on('frame', this.#captureFrameListener);
                return;
            }
            this.off('frame', this.#captureFrameListener);
        });
    }

    process(action, ...params) {
        if (!this.isReady || !this.alive) {
            return Promise.reject(new Error("channel dead or not ready."));
        }
        return DofusProcessChannel.#mut
            .wait(`process_${this.#pid}`)
            .then((release) => new Promise((resolve, reject) => {
                const id = `req-${this.#requests.size}`;
                this.#requests.set(id, this.#withTimeout(id, { resolve: (() => (resolve(), release())), reject: (() => (reject(), release())) }));
                this.#script.post({ type: "request", payload: { id, action, params } });
            }));
    }

    #clearRequests(reason) {
        if (!this.#isReady && this.#requests.size == 0) {
            return;
        }
        for (let req of this.#requests.entries()) {
            const [id, callbacks] = req;
            callbacks.reject(new Error("request failed: " + reason));
            this.#requests.delete(id);
        }
        this.#isReady = false;
        this.emit("closed");
    }

    #withTimeout(reqId, callbacks) {
        let timeout = setTimeout(() => {
            let req;
            if (!(req = this.#requests.get(reqId))) {
                return;
            }
            this.#requests.delete(reqId);
            req.reject(new Error("request timedout."));
        }, REQ_TIMEOUT);
        let clear = () => ((timeout && clearTimeout(timeout)), this.#requests.delete(reqId));
        return Object.entries(callbacks).reduce((a, b) => {
            const [id, func] = b;
            a[id] = (...args) => (clear(), func(...args));
            return a;
        }, {});
    }

    #onFrame(buffer, width, height) {
        let frame;
        this.#lastCaptureFrame = frame = this.#get_png(buffer, width, height);
        this.emit('frameAdded', this, frame, width, height);
    }


    #get_png(buffer, width, height) {
        const png = new PNG({ width, height });
        const raw = Buffer.from(buffer);

        for (let y = 0; y < height; y++) {
            const srcOffset = y * width * 4;
            const dstOffset = y * width * 4;
            raw.copy(png.data, dstOffset, srcOffset, srcOffset + width * 4);
        }

        return png;
    }
}


module.exports = class IngameProcess {

    #id;
    #pid;
    #channel;
    #env;
    #index;
    #dimentions = { width: 0, height: 0 };

    static #indexes = 0;

    static #hookScript = (function () {
        try {
            return `const IN_PROCESS_DLL_PATH = "${DLL_PATH.replace(/\\/g, "\\\\")}";\n${hookScript}`;
        }
        catch { return null; }
    })();

    static fromProcess(id, processName = "Dofus.exe") {
        return new Promise.reject(new Error("not implemented yet."));
    }

    static fromNewProcess(id, processName = "Dofus.exe", onProcess) {

        if (!IngameProcess.#hookScript)
            throw new Error("uninitialized hook script.");
        if (!fs.existsSync(DLL_PATH))
            throw new Error("dll hook path not found.");

        const controller = new AbortController();
        const { signal } = controller;

        // [TODO] deny listening if dofus processes exists

        Watcher.WaitForProcess(
            processName,
            IngameProcess.#onWatcherCallback.bind(null, id, onProcess),
            signal
        );

        return { controller, signal };
    }

    static async #onWatcherCallback(id, onProcess, err, pid) {
        if (err) {
            console.log(err.message, err.stack)
            onProcess(err)
            return;
        }
        try {
            console.log('attaching to new process...');

            const frida = await import("frida");
            const session = await frida.attach(pid);
            const script = await session.createScript(IngameProcess.#hookScript);

            const channel = new DofusProcessChannel(pid, session, script);

            await script.load();

            Watcher.ResumeProcess(pid);

            const process = new IngameProcess(id, pid, channel);

            await process.whenReady();

            onProcess(process);
        }
        catch (error) {
            console.log(error.message, error.stack)
            onProcess(error)
        }
    }

    constructor(id, pid, channel) {
        this.#pid = pid;
        this.#channel = channel;
        this.#id = id;
        this.#index = IngameProcess.#indexes++;
        this.#channel.once('closed', () => IngameProcess.#indexes--);
    }

    get id() {
        return this.#id;
    }

    get pid() {
        return this.#pid;
    }

    get env() {
        return this.#env;
    }

    get index() {
        return this.#index;
    }

    get channel() {
        return this.#channel;
    }

    get height() {
        return this.#dimentions.height;
    }

    get width() {
        return this.#dimentions.width;
    }

    whenReady() {
        if (this.#channel.isReady) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            function settle(env) {
                tmx && clearTimeout(tmx);
                ref.#channel.off("ready", settle);
                ref.#id = typeof ref.#id == "function" ? ref.#id(ref.#pid, env) : ref.#id;
                ref.#env = env;
                resolve(true);
            }
            let ref = this;
            let tmx = setTimeout(() => (ref.#channel.off("ready", settle), resolve(false)), READY_TIMEOUT);
            ref.#channel.on("ready", settle);
        });
    }

    delayed(action, timeout) {
        return new Promise((resolve, reject) => {
            let delay = !timeout ||
                timeout == 'r' ||
                isNaN(parseInt(timeout)) ||
                !isFinite(parseInt(timeout))
                ? this.#randomDelay()
                : parseInt(timeout);

            return setTimeout(() => {
                try {
                    let prom = action(this);
                    if (!prom || prom == null) {
                        resolve(prom);
                        return;
                    }
                    return prom.then(resolve).catch(reject);
                }
                catch (err) { reject(err) }
            }, delay)
        })
    }

    click(x, y) {
        return this.#untilConfirmed(
            () => this.#channel.process("click_window", x, y),
            (inputEvent) => {
                return inputEvent.type == "mousedown"
                // &&
                // inputEvent.y == y &&
                // inputEvent.x == x;
            }
        );
    }

    ClickRawWindowAt(x, y) {
        return this.#channel.process("raw_click_window", x, y, +(!this.#channel.isVisible));
    }

    type(text) {
        let _completed = "";
        return this.#untilConfirmed(
            () => this.#channel.process("type_window", text),
            (inputEvent) => {
                if (inputEvent.type !== "type") return;
                _completed += inputEvent.text;
                return _completed.toLowerCase() == text.toLowerCase();
            }
        );
    }

    hide() {
        return this.#channel.process("hide_window");
    }

    show() {
        return this.#channel.process("show_window");
    }

    resize(w, h) {
        return this.#channel.process("resize_window", w, h);
    }

    #untilConfirmed(task, confirmCb, maxAttempts = 2) {
        return new Promise((resolve, reject) => {
            let self = this, interv;
            const checker = function (_, input) {
                if (confirmCb(input)) {
                    interv && clearTimeout(interv);
                    self.channel.off('input', checker);
                    resolve();
                    return;
                }
            }
            const retry = function () {
                if (maxAttempts > 0) {
                    task();
                    interv = setTimeout(retry, 4000);
                    maxAttempts -= 1;
                }
                else {
                    interv && clearTimeout(interv);
                    self.channel.off('input', checker);
                    reject(new Error("failed to get confirmation."));
                }
            }
            // will leak here
            self.channel.on('input', checker);
            retry();
        });
    }

    #randomDelay(min = 50, max = 100) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}