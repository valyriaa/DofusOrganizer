
const defaultPlayerBubbleMarkup = (index, id, icon) => {
    const tab = document.createElement("div");
    tab.classList.add("bubble-dropdown");
    tab.id = `player-tab-${index}`;
    tab.innerHTML = `
<div id="player-tab-${index}" class="chat-message user">
    <div class="profile-bubble movable-bubble">
        <img id="player-icon-${index}" src="../avatar/${icon}" alt="profile">
        <svg class="timer-svg" viewBox="0 0 60 60">
            <defs>
                <linearGradient id="timerGradient" x1="1" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#ffda0983" />
                    <stop offset="30%" stop-color="#ff940983" />
                    <stop offset="50%" stop-color="#d8380783" />
                </linearGradient>
            </defs>
            <circle class="timer-bg" cx="30" cy="30" r="28" />
            <circle class="timer-fg" cx="30" cy="30" r="28" />
        </svg>
    </div>
</div>
<div class="bubble-menu">
    <button onclick="processScreenshot(event, '${id}')" style="margin-top: 5px;" class="misc-bubble menu-icon">✏️</button>
</div>
`
    return tab;
}

const bubblesContainer = document.querySelector('.chat-container');
const settingsBubble = bubblesContainer.querySelector('.chat-message');
const syncButton = bubblesContainer.querySelector('#startSyncBtn');

function PlayerTab(id, index) {
    var avatar = settings.icons[index];
    var isMaster = settings.master_index == index;
    var element, defaultmarkup = defaultPlayerBubbleMarkup(index, id, avatar);
    var processor = window.appContext.tabProcessor(id);
    var showing, isActived, onFight = false, currentTurn = false, processingRawClick = false;

    this.id = id;
    this.index = index;
    this.processor = processor;

    function setClass(classId, active = true) {
        const bub = element?.querySelector('.profile-bubble');
        if (!bub) return;
        const hasTimer = bub.classList.contains(classId);
        if (hasTimer == active) return;
        active ? bub.classList.add(classId) : bub.classList.remove(classId);
    }

    this.isMaster = function () {
        return isMaster;
    }

    this.processRawClick = function (x, y) {
        if (processingRawClick) {
            return Promise.resolve();
        }
        processingRawClick = true;
        return processor('raw_click_window', x, y, +(!isActived)).then(() => {
            setTimeout(() => processingRawClick = false, 6000);
        });
    }

    this.setOnFight = function (active = true) {
        if (onFight == active) {
            return;
        }
        if ((onFight = active)) {
            !isActived && this.setNotification(true);
            console.log('player entered fight.');
            return;
        }
        console.log('player fight ended.')
    }

    this.setOnTurn = function (active = true) {
        let res;
        if (currentTurn !== active) {
            currentTurn = active;
            if (currentTurn) {
                if (settings.fight_show_turn_time) {
                    this.setTimer(true);
                }
                if (settings.fight_auto_turn_window) {
                    if (activeTab && activeTab != this && settings.auto_hide) {
                        activeTab.setActive(false);
                    }
                    res = this.setActive(true);
                }
            }
            else {
                this.setTimer(false);
            }
        }
        console.log('player current turn ' + (currentTurn ? "started" : "ended"));
        return res || Promise.resolve();
    }

    this.isActive = function () {
        return isActived;
    }

    this.removeElement = function () {
        if (!element) return;
        bubblesContainer.removeChild(element);
        element = null;
    }

    this.addElement = function () {
        if (element) return;
        element = bubblesContainer.insertBefore(defaultmarkup, bubblesContainer.firstElementChild);
    }

    this.setTimer = function (active = true) {
        return setClass('turn-timer', active);
    }

    this.setNotification = function (active = true) {
        return setClass('turn-notification', active);
    }

    this.setActive = async function (active = true) {
        const bub = element?.querySelector('.profile-bubble');
        if (!bub) return;
        if (!(isActived = active)) {
            await processor('hide_window');
            bub.classList.remove('tab-active');
        }
        else {
            await processor('show_window');
            bub.classList.add('tab-active');
            activeTab = this;
        }
        this.setNotification(false);
    }

    this.onClick = async function (e) {
        if (!e || showing) return;
        e.preventDefault();
        e.stopPropagation();
        showing = true;
        if (activeTab && activeTab != this && settings.auto_hide) {
            await activeTab.setActive(false);
        }
        await this.setActive(!isActived).catch(err => {
            console.warn('failed to set active state: ', err);
        });
        showing = false;
    }

    this.addElement();

    element.querySelector('.movable-bubble')
        .addEventListener('mousedown', (e) => {
            window.isDragging = true;
            window.lastX = e.screenX;
            window.lastY = e.screenY;
        });

    element.addEventListener('click', this.onClick.bind(this));
}

let settings, activeTab, tabs = new Map();
async function Main(event) {
    settings = window.settings = await window.appContext.getSettings();

    if (event.type == "sync") {
        const { enabled } = event;
        if (!enabled) {
            settingsBubble.classList.remove('syncronized');
            syncButton.classList.remove('is-hover');
            window.isSyncronized = false;
        }
        else {
            settingsBubble.classList.add('syncronized');
            syncButton.classList.add('is-hover');
            window.isSyncronized = true;
        };
    }
    else if (event.type == "new-process") {
        let { index, id } = event;
        let ref = new PlayerTab(id, index);
        tabs.set(ref.id, ref);
        if (settings.auto_hide) {
            await ref.setActive(false);
        }
    }
    else if (event.type == "remove-process") {
        let { id } = event;
        let tab = tabs.get(id);
        if (tab) {
            tab.removeElement();
            tabs.delete(id);
            // let nextActive = Array.from(tabs.values()).pop();
            // if (nextActive) {
            //     await nextActive.setActive(true);
            // }
            // if master & close_all_on_master
            // if not, and this is activeTab, set active tab to the next index
        }
    }
    else if (event.type == "process_state") {
        let { id, state } = event;
        let tab = tabs.get(id);
        if (!tab || !state) return;

        const tasks = [
            tab.setOnFight(state.onFight),
            tab.setOnTurn(state.onTurn)
        ];

        for (let hint of state.events) {
            const { id, active, coordinates } = hint;
            if (active && coordinates) {
                const { x, y } = coordinates;
                tasks.push(tab.processRawClick(x, y));
                console.log(`${id} active.`);
            }
        }

        await Promise.all(tasks).catch(err => {
            console.log(err);
        });
    }
}