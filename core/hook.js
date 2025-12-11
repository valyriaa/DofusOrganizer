

module.exports = `
const mod = Module.load(IN_PROCESS_DLL_PATH);

const StartInitPtr = mod.getExportByName("Init");
const IsReadyPtr = mod.getExportByName("IsReady");
const GetFramePtr = mod.getExportByName("GetFrame");
const FreeFrameBufferPtr = mod.getExportByName("FreeFrameBuffer");
const HideWindowPtr = mod.getExportByName("HideTargetWindow");
const ShowWindowPtr = mod.getExportByName("ShowTargetWindow");
const ClickWindowAtPtr = mod.getExportByName("ClickWindowAt");
const ClickRawWindowAtPtr = mod.getExportByName("ClickRawWindowAt");
const TypeWindowPtr = mod.getExportByName("TypeWindow");
const ResizeWindowPtr = mod.getExportByName("ResizeWindow");
const CloseWindowPtr = mod.getExportByName("CloseTargetWindow");

const Init = new NativeFunction(StartInitPtr, 'int', ["pointer", "pointer", "pointer"]);
const IsReady = new NativeFunction(IsReadyPtr, 'bool', []);
const FreeFrameBuffer = new NativeFunction(FreeFrameBufferPtr, 'void', ["pointer"]);
const ShowWindow = new NativeFunction(ShowWindowPtr, 'void', []);
const ClickWindowAt = new NativeFunction(ClickWindowAtPtr, 'void', ['int', 'int']);
const ClickRawWindowAt = new NativeFunction(ClickRawWindowAtPtr, 'void', ['int', 'int', 'int']);
const TypeWindow = new NativeFunction(TypeWindowPtr, 'void', ['pointer']);
const HideWindow = new NativeFunction(HideWindowPtr, 'void', []);
const GetFrame = new NativeFunction(GetFramePtr, 'bool', ['pointer', 'pointer', 'pointer', 'pointer', 'pointer']);
const ResizeWindow = new NativeFunction(ResizeWindowPtr, 'void', ['int', 'int']);
const CloseWindow = new NativeFunction(CloseWindowPtr, 'void', []);

const sizePtr = Memory.alloc(4);
const wPtr = Memory.alloc(4);
const hPtr = Memory.alloc(4);
const pPtr = Memory.alloc(4);
const pBuffer = Memory.alloc(Process.pointerSize);
const events = [];

function getFrameScreenshot() {
    try {
        const ok = GetFrame(pBuffer, sizePtr, wPtr, hPtr, pPtr);

        if (!ok) {
            return { error: new Error("failed to get frame.") };
        }

        const realBufferPtr = pBuffer.readPointer();
        const size = sizePtr.readU32();
        const w = wPtr.readU32();
        const h = hPtr.readU32();
        const p = pPtr.readU32();

        const jsBuffer = realBufferPtr.readByteArray(size);

        FreeFrameBuffer(realBufferPtr);

        return {
            type: "frame",
            width: w,
            height: h,
            pitch: p,
            size: size,
            jsBuffer
        };
    }
    catch (error) {
        return { error };
    }
}

function parseEventMessage(type, msg, wParam, lParam) {
    if (type == "mouse") {
        let x = lParam & 0xFFFF;
        let y = (lParam >> 16) & 0xFFFF;

        // const ptPtr = Memory.alloc(8);
        // ptPtr.add(0).writeS32(x);
        // ptPtr.add(4).writeS32(y);
        // NativeClientToScreen(ptPtr);
        // x = ptPtr.add(0).readS32();
        // y = ptPtr.add(4).readS32();

        switch (msg) {
            case 0x201:
                return { type: "mousedown", button: "left", x, y };
            case 0x202:
                return { type: "mouseup", button: "left", x, y };
            case 0x200:
                return { type: "mousemove", x, y };
            case 0x204:
                return { type: "mousedown", button: "right", x, y };
            case 0x205:
                return { type: "mouseup", button: "right", x, y };
            default:
                return null;
        }
    }
    else if (type == "keyboard") {
        const vk = wParam;
        switch (msg) {
            // case 0x100:
            //     return { type: "keydown", keyCode: vk, char: String.fromCharCode(vk) };
            case 0x101:
                return { type: "keyup", keyCode: vk, char: String.fromCharCode(vk) };
            case 0x102:
                return { type: "char", char: String.fromCharCode(vk) };
            default:
                return null;
        }
    }
    return null;
}

function parseEnvBlock(ptr, size) {
    const buf = ptr.readByteArray(size);
    const data = new Uint16Array(buf);

    let current = "";
    const env = {};

    for (let i = 0; i < data.length; i++) {
        const ch = data[i];

        if (ch === 0) {
            if (current.length === 0)
                break

            const eq = current.indexOf('=');
            if (eq > 0) {
                const key = current.slice(0, eq);
                const val = current.slice(eq + 1);
                env[key] = val;
            }
            current = "";
        } else {
            current += String.fromCharCode(ch);
        }
    }

    return env;
}

const onReady = new NativeCallback(
    (envPtr, size) => {
        if (!isReady) {
            isReady = true;
            env = parseEnvBlock(envPtr, size);
            send({ type: "ready", env });
        }
    },
    'void',
    ['pointer', 'uint64']
);

const onVisibility = new NativeCallback(
    (isVisible) => send({ type: "visibility", isVisible }),
    'void',
    ['int']
);

const onInput = new NativeCallback(
    (msg, wParam, lParam) => {
        try {
          let event = parseEventMessage('mouse', msg, wParam, lParam);
          if (!event) {
              event = parseEventMessage('keyboard', msg, wParam, lParam);
              currentText += event.char || '';
              typingTmx && clearTimeout(typingTmx);
              typingTmx = setTimeout(() => {
                  let newEv = { ...event, type: "type", text: currentText };
                  send({ type: "input_event", event: newEv });
                  currentText = "";
                  typingTmx = undefined;
              }, 1000);
              return;
           }
           send({ type: "input_event", event });
        }
        catch(error) {
          console.log(error);
        }
    },
    'void',
    ['int', 'int', 'int']
);

function sendNewFrame() {
    if (!isReady) return;
    const { error, jsBuffer, width, height } = getFrameScreenshot();
    if (error) {
        console.warn(\`failed to get new frame: \`, error);
        return;
    }
    return send({ type: "frame", width, height }, jsBuffer);
}

function processMessage(msg) {
    const { id, action, params } = msg.payload || {};
    let result = { id };
    try {
        switch (action) {
            case "show_window":
                ShowWindow();
                break
            case "hide_window":
                HideWindow();
                break;
            case "is_ready":
                result.data = IsReady();
                break;
            case "click_window":
                ClickWindowAt(...params);
                break;
            case "raw_click_window":
                ClickRawWindowAt(...params);
                break;
            case "type_window":
                const textPtr = Memory.allocUtf16String(params[0]);
                TypeWindow(textPtr);
                break;
            case "resize":
                ResizeWindow(...params);
                break;
            case "frame_screen":
                const { error, jsBuffer, ...metadata } = getFrameScreenshot();
                result.ok = !error;
                result.error = error;
                result.buffer = jsBuffer;
                result.data = metadata;
                break;

            case "enableFrame":
                if (!params[0]) {
                    frameRecordInterv && clearInterval(frameRecordInterv);
                }
                else {
                    frameRecordInterv = setInterval(sendNewFrame, params[1] || (1500));
                }
                break;

            case "close_window":
                CloseWindow();
                break;
            default:
                break;
        }

        if (result.ok == undefined) {
            result.ok = true;
        }
    }
    catch (error) {
        result.ok = false;
        result.error = error.message;
        console.log(error)
    }
    let buffer = result.buffer;
    delete result.buffer;
    send(result, buffer);
    recv('request', processMessage);
}

let typingTmx,
    isReady = false,
    env,
    currentText = '',
    frameRecordInterv;

try {
   Init(ptr(onReady), ptr(onInput), ptr(onVisibility));
   frameRecordInterv = setTimeout(() => frameRecordInterv = setInterval(sendNewFrame, 1500), 10000);
   recv('request', processMessage);
}
catch(error) {
   console.error(error);
}
`;