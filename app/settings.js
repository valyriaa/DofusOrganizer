const path = require('node:path');
const EventEmitter = require('events').EventEmitter;
const os = require('os');
const fs = require('fs');
const { app } = require('electron')

const DEFAULT_PATH = path.join(os.homedir(), ".dd-organize");

const avatars = fs.readdirSync(path.join(__dirname, "assets", "avatar"));

const DEFAULT_INIT_CONFIG = {
    lang: 'fr',
    master_index: 0,
    auto_update: true,
    auto_hide: true,
    auto_listen: true,
    open_startup: true,
    icons: Array(9).map((_, i) => `${(i + 1) * 10}_1.png`),
    avatars,
    core_start_pos: 'top-center',
    replay_mouse_wait: 'r',
    replay_keyboard_wait: 'r',
    random_click_rect_margin_x: 5,
    random_click_rect_margin_y: 2,
    replay_keyboard: true,
    frame_capture_enabled: true,
    fight_ready_all: true,
    fight_show_turn_time: true,
    fight_auto_turn_window: true,
    prevent_inactivity: true,
    auto_accept_exchange_request: true,
    auto_accept_exchange: false,
    auto_accept_group_invite: false,
    shortcuts: {}
}

const onExit = (function exit() {
    var isSignaled = false, isExiting;

    var SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'];
    var shutdownListeners = [];

    process.stdin.resume();

    const processOnce = (signals, fn) => {
        return signals.forEach(sig => {
            process.on(sig, fn.bind(null, sig));
        });
    };

    async function shutdownHandler(error) {
        if (!isSignaled) {
            console.log('unhandled error occured: ', error);
            const promises = [...shutdownListeners].map((f, i) => f(error));
            Promise.allSettled(promises).then(() => {
                return process.exit(0);
            });
            isSignaled = true;
            return;
        }
    }

    processOnce(SHUTDOWN_SIGNALS, shutdownHandler);

    function addListener(listener, clearAll) {
        clearAll && (shutdownListeners = [])
        shutdownListeners.push(listener);
        return listener;
    };

    Object.defineProperty(addListener, 'isSignaled', {
        get: function () {
            return isSignaled;
        }
    });

    addListener.shutdownHandler = shutdownHandler;
    addListener.clear = function () {
        shutdownListeners = [];
    };

    process.once('uncaughtException', shutdownHandler);
    process.once('unhandledRejection', shutdownHandler);

    app.on('before-quit', shutdownHandler);
    app.on('will-quit', shutdownHandler);
    app.on('quit', shutdownHandler);

    if (typeof process.env.STOP_TIME_MIN == 'number') {
        setTimeout(shutdownHandler, process.env.STOP_TIME_MIN * 60 * 1000)
    }

    return addListener;
})()

function getPropertyTypeValue(key, val) {
    if (val == undefined || val == null) {
        if (typeof DEFAULT_INIT_CONFIG[key] == "string") {
            return "";
        }
        else if (typeof DEFAULT_INIT_CONFIG[key] == "number") {
            return 0;
        }
        return val;
    }
    else if (typeof DEFAULT_INIT_CONFIG[key] == "object") {
        try {
            return JSON.parse(Buffer.from(val, "hex").toString("utf-8"));
        }
        catch { return null; }
    }
    else if (/^\d+$/.test(val) && !isNaN(parseInt(val))) {
        return parseInt(val);
    }
    else if (val == "true" || val == "false") {
        return val == "true";
    }
    else if (val == "undefined" || val == "null") {
        return null;
    }
    return val;
}

function getSaveValue(key, val) {
    if (typeof DEFAULT_INIT_CONFIG[key] == "object") {
        try {
            return Buffer.from(JSON.stringify(val), "utf-8").toString("hex");
        }
        catch { return ""; }
    }
    return getPropertyTypeValue(key, val);
}

function readProperties(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const properties = {};

    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('#') || line.startsWith('!')) continue;

        const delimiterIndex = line.indexOf('=');
        if (delimiterIndex === -1) continue;

        const key = line.substring(0, delimiterIndex).trim();
        const value = line.substring(delimiterIndex + 1).trim();

        properties[key] = getPropertyTypeValue(key, value);
    }

    return properties;
}

var initInstance;

function ConfigFile(initConfig = DEFAULT_INIT_CONFIG) {
    if (!initInstance) {
        let initFile = path.join(DEFAULT_PATH, "cfg.properties");
        let initContent, emitter = new EventEmitter();
        if (!fs.existsSync(initFile)) {
            if (!fs.existsSync(path.dirname(initFile))) {
                fs.mkdirSync(path.dirname(initFile));
            }
            initContent = {
                ...DEFAULT_INIT_CONFIG,
                ...initConfig
            }
            fs.writeFileSync(initFile, Object.entries(initContent).map((entry) => `${entry[0]} = ${getSaveValue(...entry)}`).join('\n'));
        }
        else {
            initContent = readProperties(initFile);
        }

        this.get = function (key) {
            return initContent[key];
        }

        this.set = function (key, value) {
            initContent[key] = value;
            this.save();
            emitter.emit('update', key, value);
        }

        this.json = function () {
            return !initContent ? null : JSON.stringify(initContent);
        }

        this.save = function () {
            fs.writeFileSync(initFile, Object.entries(initContent).map((entry) => `${entry[0]} = ${getSaveValue(...entry)}`).join('\n'));
            console.info(`settings filed saved....`);
        }

        this.events = emitter;

        onExit(this.save.bind(this));

        initInstance = Object.freeze(this);

        console.info(`init file loaded.`);
    }

    return initInstance;
}

Object.defineProperty(ConfigFile, "instance", {
    get: () => new ConfigFile()
});

Object.defineProperty(ConfigFile, "defaults", {
    get: () => Object.freeze(DEFAULT_INIT_CONFIG)
});

Object.defineProperty(ConfigFile, "base_dir", {
    get: () => DEFAULT_PATH
})

module.exports = ConfigFile;