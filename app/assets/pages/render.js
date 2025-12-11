
function HTMLElement(html) {
    let div = document.createElement('div');
    div.innerHTML = html;
    if (div.firstElementChild && div.firstElementChild !== null) {
        return div.firstElementChild;
    }
    else if (div.firstChild && div.firstChild !== null) {
        return div.firstChild;
    }
    let tag = /^<([^\s>]*)?\s?.+?>/gm.exec(html)[1];
    let element = document.createElement(tag);
    let newHtml = html.replace(`<${tag}`, '<div').replace(`</${tag}>`, '</div>');
    let tagProps = HTMLElement(newHtml);
    element.innerHTML = '';
    element.classList.add(...Array.from(tagProps.classList.values()));
    element.style.cssText = document.defaultView.getComputedStyle(tagProps, "").cssText; // broke IE
    for (let attr of tagProps.getAttributeNames()) {
        element.setAttribute(attr, tagProps.getAttribute(attr));
    }
    element.innerText = tagProps.innerText;
    element.innerHTML = tagProps.innerHTML;
    return element;
}

function createElement(type, props) {

    if (props == undefined) {
        props = {};
    }

    let classList = props.class || props.className;
    let text = props.text || props.innerText;
    let html = props.html || props.innerHTML;
    let childs = props.childs || props.childrens || props.elements || [];
    let events = props.events || {};
    let ref = props.ref;

    delete props.class;
    delete props.className;
    delete props.innerText;
    delete props.innerHTML;
    delete props.html;
    delete props.text;
    delete props.childs;
    delete props.childrens;
    delete props.elements;
    delete props.events;
    delete props.ref;

    let elem = HTMLElement(`<${type}${Object.entries(props).map(e => ` ${e[0]}="${e[1]}"`).join(' ')}></${type}>`);

    if (!!classList && !Array.isArray(classList)) {
        classList = classList.split(' ');
    }

    classList && elem.classList.add(...classList);

    for (let eventEntry of Object.entries(events || {})) {
        const [event, eventHandler] = eventEntry;
        elem.addEventListener(event, eventHandler);
    }

    if (text !== undefined) {
        elem.innerText = text;
    }
    else if (html !== undefined) {
        elem.innerHTML = html;
    }

    if (childs !== undefined) {
        if (!Array.isArray(childs)) {
            childs = Object.entries(childs).map((entry) => ({
                $tag: entry[0],
                ...entry[1]
            }));
        }
        for (let child of childs) {
            if (!child.$tag) {
                for (let componentChild of Object.values(child)) {
                    elem.appendChild(componentChild);
                }
            }
            else {
                let tag = child.$tag;
                delete child.$tag;
                if (tag !== undefined) {
                    elem.appendChild(createElement(tag, child));
                }
            }
        }
    }
    if (ref !== undefined) {
        ref(elem);
    }
    return elem;
}

function Component(root) {
    let _component = {};
    let childs = [];
    let onLoadFunc;
    let lastComponent;
    let refs = [];
    let _root = root;
    let _mainroot;

    if (typeof _root !== 'object') {
        _root = document.createElement('div');
    }

    function append(type, props) {
        return childs.push(createElement(type, props));
    }

    function appendComponent(component) {
        if (component instanceof HTMLElement || component.ELEMENT_NODE !== undefined) {
            return childs.push(component);
        }
        else if (component.length == undefined) {
            throw new Error(`invalid component supplied.`);
        }
        return childs.push(...component);
    }

    function cleanRoot() {
        if (typeof root == 'object') {
            for (let child of childs.concat(refs)) {
                if (Array.from(_root.childNodes.values()).some(c => c == child)) {
                    _root.removeChild(child)
                }
            }
            _root.innerHTML = '';
        }
        refs = [];
    }

    function clear() {
        cleanRoot();
        if (_mainroot) {
            for (let child of _mainroot.childNodes) {
                _mainroot.removeChild(child);
            }
        }
        childs = [];
    }

    function onLoad(func) {
        onLoadFunc = func.bind(_component);
    }

    function display(execLoadFunc) {
        if (_root.style.display == 'none') {
            _root.style.display = 'block';
        }
        if (_root.style.visibility == 'hidden') {
            _root.style.visibility = 'unset';
        }
        execLoadFunc && onLoadFunc && onLoadFunc();
    }

    function render(execLoadFunc = true) {

        lastComponent = _root.innerHTML;

        if (_root.style.display == 'block') {
            _root.style.display = 'none';
        }

        cleanRoot();

        for (let child of childs) {
            child && _root.appendChild(child);
        }

        for (let ref of refs) {
            ref && _root.appendChild(ref);
        }

        window.requestAnimationFrame(display.bind(null, execLoadFunc));

        if (root == _root) {
            return _root;
        }

        return _root.childNodes;
    }

    function ref() {
        let newRef = createElement("div");
        refs.push(newRef);
        return Component(null, newRef);
    }

    Object.defineProperties(_component, {
        root: { get: () => _root },
        append: { get: () => append },
        appendComponent: { get: () => appendComponent },
        render: { get: () => render },
        clear: { get: () => clear },
        onLoad: { get: () => onLoad },
        newRef: { get: () => ref },
    });

    return _component;
}