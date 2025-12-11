const Processor = require('../core/process');
const ConfigFile = require('./settings');
const EventEmitter = require("events").EventEmitter;
const PNG = require("pngjs").PNG;
const matcher = require('../core/match');
const fs = require('fs');
const path = require('path');
const Sourcer = require('../core/sourcer');

const MIN_DETECTION_CONFIDENCE_SECORE = .65;

module.exports = class Container extends EventEmitter {
    #settings = ConfigFile.instance;
    #processes = new Map();
    #id;
    #processName;
    #listening = false;
    #listenSingal;
    #mainWindow;
    #cropperWindow;

    #syncronized = false;
    #processMasterInputsListener;

    #processFramesListener;
    #currentMaster;
    #currentStates = new Map();
    #templatesLoaded;
    #loadedHints = [];

    #framesSourcer = new Sourcer();
    #framesGenerator;
    #processing = false;
    #exiting = null;

    static #instances = [];

    constructor(windows, id, processName) {
        super();

        if (Container.#instances.includes(id)) {
            throw new Error(`instance for '${id}' already created.`)
        }

        this.#mainWindow = windows.main;
        this.#cropperWindow = windows.hintCropper;
        this.#id = id;
        this.#processName = processName;
        this.#processFramesListener = this.#onChannelFrame.bind(this);

        Container.#instances.push(this);

        this.#framesGenerator = this.#_framesGenerator();

        this.#settings.events.on('update', this.#settingsUpdated.bind(this));

        this.listenForProcess(this.#settings.get('auto_listen'));
    }

    get id() {
        return this.#id;
    }

    get syncronized() {
        return this.#syncronized;
    }

    get processes() {
        return this.#processes.size;
    }

    get master() {
        const master_index = this.#settings.get('master_index');
        return Array.from(this.#processes.values()).filter(p => p.index == master_index)[0];
    }

    get team() {
        const master_index = this.#settings.get('master_index');
        return Array.from(this.#processes.values()).filter(p => p.index !== master_index)
    }

    getState(id) {
        return this.#currentStates.get(id);
    }

    getByPid(pid) {
        return Array.from(this.#processes.values()).filter(p => p.pid == pid)[0];
    }

    getHint(id) {
        return this.#loadedHints.filter(s => s.id == id)[0];
    }

    process(processId, task, ...args) {
        var process = this.#processes.get(processId);
        if (!process) return Promise.resolve();
        return process.channel.process(task, ...args).catch(err => {
            console.log(err)
        });
    }

    sync(syncronized = true, restart = false) {
        if (this.#syncronized !== syncronized || restart) {
            let master = this.master, team = this.team;
            if (!syncronized) {
                if (master && this.#processMasterInputsListener) {
                    master.channel.off('input', this.#processMasterInputsListener);
                }
                this.#syncronized = false;
            }
            else {
                if (team.length == 0) {
                    return Promise.resolve({ error: 'not_connected' });
                }
                else if (!master) {
                    return Promise.resolve({ error: 'missing_master' });
                }

                master.channel.on('input', this.#processMasterInputsListener = this.#onProcessInput.bind(this));

                this.#currentMaster = master;
                this.#syncronized = true;
            }
            this.#sendEvent("sync", { enabled: syncronized });
        }
        return Promise.resolve({ sync: syncronized });
    }

    listenForProcess(listen = true) {
        if (listen == this.#listening) {
            return Promise.resolve();
        }
        this.#listening = listen;
        if (this.#listening == false) {
            return new Promise((resolve) => {
                try {
                    let ref = this;
                    this.#listenSingal.signal.addEventListener('abort', function () {
                        ref.#sendEvent("listen", { enabled: false });
                        resolve();
                    }, { once: true });
                    this.#listenSingal.controller.abort();
                }
                catch (error) {
                    console.error(error);
                    resolve();
                }
            });
        }
        this.#listenSingal = Processor.fromNewProcess(
            (pid, env) => pid + "-" + env.ACCOUNT_ID,
            this.#processName,
            this.#onNewProcess.bind(this)
        );
        this.#sendEvent("listen", { enabled: true });
        return Promise.resolve();
    }

    exit() {
        if (this.#exiting) {
            return this.#exiting;
        }
        return this.#exiting = new Promise((resolve) => {
            const cleanup = function () {
                return Promise.all([ref.sync(false), ref.listenForProcess(false)]).then(resolve);
            }

            const onAllClosed = function () {
                cleanup();
                setImmediate(() => ref.#exiting = undefined);
            };

            const ref = this;

            if (this.#processes.size == 0) {
                cleanup();
                return;
            }

            this.once("idle", onAllClosed);

            // we could later use the frida session here to kill the process,
            // if hwnd didn't process the WM_CLOSE (freezed or busy)
            Promise.all(
                Array.from(this.#processes.values()).map(p => p.channel.process("close_window"))
            );
        });
    }

    processFrame(processId) {
        let target, frame;
        if (!(target = this.#processes.get(processId)) || !(frame = target.channel.frame)) {
            return;
        }
        let { height, width } = frame;
        let encoded = PNG.sync.write(frame);
        this.#cropperWindow.setSize(frame.width, frame.height + 60);
        this.#cropperWindow.webContents.send("image-content", { processId, height, width, data: encoded.toString("base64") });
        this.#cropperWindow.show();
    }

    async processNextFrame() {
        if (this.#processing) return;
        while ((this.#processing = true)) {
            const { value, done } = await this.#framesGenerator.next();
            if (done || value === undefined) {
                await this.#waitNextFrame();
                continue;
            }
            try {
                await this.#onProcessFrame(...value);
            }
            catch (error) {
                console.warn(`processing frame failed: `)
                console.error(error);
            }
        }
    }

    /*
      TODO: - all windows size must be 'MARGINALLY' equals
            - notify about it
    */
    #onNewProcess(gameProcess) {
        if (!gameProcess || gameProcess instanceof Error) {
            console.error(gameProcess);
        }
        else {
            const parms = { id: gameProcess.id, index: gameProcess.index };
            gameProcess.channel.once('closed', async () => {

                if (gameProcess == this.master) {
                    await this.sync(false);
                }

                gameProcess.channel.off('frameAdded', this.#processFramesListener);
                this.#processes.delete(gameProcess.id);
                this.#currentStates.delete(gameProcess.id);
                this.#sendEvent("remove-process", parms);
                this.emit("remove-process");

                if (this.#processes.size == 0) {
                    this.#templatesLoaded = false;
                    this.emit('idle');
                }
            });

            if (this.#settings.get('frame_capture_enabled') == true) {
                gameProcess.channel.on('frameAdded', this.#processFramesListener);
            }

            this.#processes.set(gameProcess.id, gameProcess);
            this.#sendEvent("new-process", parms);
            this.emit("new-process");
            console.log(`new process at: ${gameProcess.pid}`)
        }
    }

    #onProcessInput(_, input) {
        const followers = this.team;
        const master = this.master;
        if (this.syncronized && followers.length > 0) {
            let isAutoHide = this.#settings.get('auto_hide');
            for (let follower of followers) {
                switch (input.type) {
                    case 'mousedown':
                        let point = { x: input.x, y: input.y };
                        if (master.height != follower.height || master.width != follower.width) {
                            point = this.#scalePoint(point.x, point.y, master.width, master.height, follower.width, follower.height);
                            console.log('target point scaled for follower.')
                        }
                        point = this.#randomizeFollowerPoint(point);
                        follower.delayed(
                            f => !isAutoHide ? f.ClickRawWindowAt(point.x, point.y) : f.click(point.x, point.y),
                            this.#settings.get('replay_mouse_wait')
                        ).catch(err => console.log(`failed to send click to member: '${follower.index}'`, err));
                        console.info(`[+] click (${input.x}, ${input.y}) in member ${follower.index}`);
                        break;

                    case 'type':
                        if (this.#settings.get('replay_keyboard')) {
                            follower.delayed(
                                f => f.type(input.text),
                                this.#settings.get('replay_keyboard_wait')
                            ).catch(err => console.log(`failed to send type to member: '${follower.index}'`, err));
                            console.info(`[+] input (${input.text}) in member ${follower.index}`);
                        }
                        break;

                    default:
                        console.info(`input '${input.type}' ignored.`);
                        break;
                }
            }
        }
    }

    async #onProcessFrame(channel, frame, width, height) {
        const member = this.getByPid(channel.pid);
        if (!member || !width || !height) {
            return;
        }
        if (!this.#templatesLoaded) {
            this.#loadedHints = this.#loadHints(width, height);
            matcher.loadTemplates(this.#loadedHints, { width, height });
            this.#templatesLoaded = true;
            console.info(`(${this.#loadedHints.length}) hint(s) loaded..`)
        }
        const results = await matcher.findTemplates(frame);
        const newState = this.#createState(member, results.filter(r => r.score >= MIN_DETECTION_CONFIDENCE_SECORE));
        newState && await this.#sendEvent('process_state', { id: member.id, index: member.index, state: newState });
    }

    async #sendEvent(eventName, eventParams) {
        let eventData = { type: eventName, ...eventParams };
        try {
            await this.#mainWindow.webContents.send("event", eventData)
            this.emit("event", eventData);
            console.info(`event ${eventName} sent.`)
        }
        catch (error) {
            console.info(`failed to send event ${eventName}.`);
            console.error(error);
        }
    }

    #settingsUpdated(key, value) {
        switch (key) {
            case 'auto_listen':
                this.listenForProcess(value);
                break;
            case 'master_index':
                if (this.#currentMaster?.index != value && this.#syncronized) {
                    this.sync(true, true);
                }
                break;
            case 'frame_capture_enabled':
                for (let process of this.#processes.values()) {
                    process.channel.onFrame(this.#processFramesListener, !value);
                }
                break;
        }
        console.log('settings updated', key, value)
    }

    // one loop result once too many hints
    #createState(member, frameResults) {
        let onFight = frameResults.some(r => (r.id == "fight_start" || r.id == "on_fight"));
        let onTurnIndices = frameResults.filter(r => r.id.startsWith("turn_")).sort((a, b) => b.score - a.score)[0];

        let inactivity = this.#coordinatesState(frameResults, "on_inactivity", "prevent_inactivity_ok");
        let group = this.#coordinatesState(frameResults, "on_group", "accept_group");
        let exchange = this.#coordinatesState(frameResults, "on_exchange", "accept_exchange");
        let acceptedExchange = this.#coordinatesState(frameResults, "exchange_accepted", "validate_exchange");
        let groupFight = this.#coordinatesState(frameResults, "join_fight", "join_fight");

        let onTurn = onTurnIndices?.id == "turn_on" ? true : false;
        let current = this.getState(member.id);
        let newState = {
            onFight,
            onTurn,
            events: [
                group,
                inactivity,
                exchange,
                acceptedExchange,
                groupFight
            ]
        };
        if (current && this.#isSameState(current, newState)) {
            return;
        }
        this.#currentStates.set(member.id, newState);
        return newState;
    }

    #scalePoint(x, y, w, h, newWidth, newHeight) {
        const scaleX = newWidth / w;
        const scaleY = newHeight / h;

        return {
            x: x * scaleX,
            y: y * scaleY
        };
    }

    #coordinatesState(frameResults, id, coordsId) {
        let onId = false, onCoordsId = null;
        if ((onId = frameResults.filter(r => r.id == id)[0])) {
            onCoordsId = frameResults.filter(r => r.id == coordsId)[0];
            if (onCoordsId) {
                const { x, y } = onCoordsId;
                onCoordsId = this.#randomPoint(x, y, 10);
            }
            onId = true;
        }
        return { id, "active": onId, "coordinates": onCoordsId };
    }

    #randomizeFollowerPoint(point) {
        let margin_x = this.#settings.get('random_click_rect_margin_x') || ConfigFile.defaults.random_click_rect_margin_x;
        let margin_y = this.#settings.get('random_click_rect_margin_y') || ConfigFile.defaults.random_click_rect_margin_y;
        let { x, y } = point;
        const left = x - margin_x;
        const right = x + margin_x;
        const top = y - margin_y;
        const bottom = y + margin_y;
        const rx = Math.random() * (right - left) + left;
        const ry = Math.random() * (bottom - top) + top;
        return { x: Math.floor(rx), y: Math.floor(ry) };
    }

    #randomPoint(centerX, centerY, margin) {
        const minX = centerX - margin;
        const maxX = centerX + margin;
        const minY = centerY - margin;
        const maxY = centerY + margin;

        const randX = Math.random() * (maxX - minX) + minX;
        const randY = Math.random() * (maxY - minY) + minY;

        return { x: randX, y: randY };
    }

    #isSameState(state, newState) {
        return JSON.stringify(state) == JSON.stringify(newState);
    }

    #onChannelFrame(...frameArgs) {
        this.#framesSourcer.add(frameArgs);
        this.processNextFrame();
        this.emit('frameAdded', ...frameArgs);
    }

    async *#_framesGenerator() {
        while (true) {
            if (!this.#framesSourcer.stillHas()) {
                await this.#waitNextFrame();
            }
            yield this.#framesSourcer.next();
        }
    }

    #waitNextFrame() {
        return new Promise((resolve) => this.once('frameAdded', resolve));
    }

    #loadHints(w, h) {
        try {
            let indices = [];
            let ref = [];
            let lang = this.#settings.get('lang');
            let userDir = path.join(ConfigFile.base_dir, lang, `${w}x${h}`);
            let targetLang = `_${lang}.png`;
            let indicesPath = path.join(__dirname, "assets", "indices");


            if (fs.existsSync(userDir)) {
                indices = fs.readdirSync(userDir).filter(p => p.endsWith(targetLang)).map(s => path.join(userDir, s));
            }

            for (let defaultIndice of fs.readdirSync(indicesPath).filter(p => p.endsWith(targetLang))) {
                if (!indices.some(s => s.endsWith(defaultIndice))) {
                    indices.push(path.join(indicesPath, defaultIndice));
                }
            }

            for (let filePath of indices) {
                try {
                    const indice = path.basename(filePath);
                    const buffer = fs.readFileSync(filePath);
                    const png = PNG.sync.read(buffer);
                    const id = indice.split('.')[0]?.replace(`_${ConfigFile.instance.get('lang')}`, '');
                    let rect = null, original = { originalWidth: 0, originalHeight: 0 };
                    if (fs.existsSync(`${filePath}.r`)) {
                        try {
                            const result = JSON.parse(fs.readFileSync(`${filePath}.r`));
                            rect = result.rect;
                            original = result.from;
                        }
                        catch (err) { }
                    }
                    ref.push({ png, id, rect, ...original });
                }
                catch (error) {
                    console.warn(`failed to load game indice '${path.basename(filePath)}'...`);
                    console.error(error);
                    // TODO: append to missing hints
                    // missing hints will be notified about later
                }
            }
            return ref;
        }
        catch (error) {
            console.warn('failed to load game indices...');
            console.error(error);
            return [];
        }
    }
}