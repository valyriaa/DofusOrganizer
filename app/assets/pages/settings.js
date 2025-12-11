(window.renderSettings = async () => {
    const settings = window.settings = await appContext.getSettings();
    const locals = window.settings = await appContext.getLocal();
    const versionData = await window.appContext.versionData();
    const { version, changelog, githubUrl, discordInviteLink } = versionData || {
        version: '1.0.0',
        changelog: ["1.0.0 – Project start."],
        githubUrl: 'https://github.com/valyriaa/DofusOrganizer',
        discordInviteLink: 'organizer'
    };

    function L(message, ...args) {
        let lc = locals[message] || message;
        for (let i = 0; i < args.length; i++) {
            let arg = !args[i] ? "" : args[i].toString();
            lc = lc.replace(`%${i}`, arg);
        }
        return lc;
    }

    const versionSection = {
        $tag: "section",
        id: "about",
        class: "card",
        role: "tabpanel",
        childs: [
            {
                $tag: "h2",
                text: L(`Version %0`, version)
            },
            {
                $tag: "p",
                text: L("This application was built to assist with multi-client management and automation.")
            },
            {
                $tag: "div",
                class: "externals",
                childs: [
                    {
                        $tag: "a",
                        href: "#",
                        html: `<svg style="width:36px; height: 36px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16"
                        fill="currentColor" class="bi bi-discord" viewBox="0 0 16 16">
                        <path
                            d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032q.003.022.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019q.463-.63.818-1.329a.05.05 0 0 0-.01-.059l-.018-.011a9 9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066l.015-.019q.127-.095.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007q.121.1.248.195a.05.05 0 0 1-.004.085 8 8 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.019m-8.198 7.307c-.789 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612m5.316 0c-.788 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612" />
                    </svg>`,
                        'url': githubUrl
                    },
                    {
                        $tag: "span",
                        text: " • "
                    },
                    {
                        $tag: "a",
                        href: "#",
                        html: `<svg style="width:36px; height: 36px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16"
                        fill="currentColor" class="bi bi-github" viewBox="0 0 16 16">
                        <path
                            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
                    </svg>`,
                        'url': `https://discord.com/invite/${discordInviteLink}`
                    }
                ]
            },
            {
                $tag: "div",
                class: "patch-notes",
                style: {
                    maxHeight: "200px",
                    overflowY: "auto",
                    marginTop: "16px",
                    paddingRight: "6px"
                },
                childs: [
                    {
                        $tag: "h3",
                        text: L("Patch Notes")
                    },
                    {
                        $tag: "ul",
                        childs: changelog.map(p => ({
                            $tag: "li",
                            text: L(p)
                        }))
                    }
                ]
            }
        ]
    };

    const SettingsPage = Component(document.body);

    SettingsPage.append("div", {
        class: "wrap",
        role: "application",
        childs: [
            {
                $tag: "button",
                class: "icon-close",
                "aria-label": L("Close icons tab"),
                text: "×"
            },
            {
                $tag: "header",
                childs: [
                    {
                        $tag: "div",
                        childs: [
                            { $tag: "h1", text: L("Settings") }
                        ]
                    },
                    {
                        $tag: "nav",
                        childs: [
                            {
                                $tag: "div",
                                class: "tabs",
                                role: "tablist",
                                "aria-label": L("Settings tabs"),
                                childs: [
                                    { $tag: "button", class: "tab active", "data-target": "general", role: "tab", "aria-selected": "true", text: L("General") },
                                    { $tag: "button", class: "tab", "data-target": "game", role: "tab", text: L("Game") },
                                    { $tag: "button", class: "tab", "data-target": "about", role: "tab", text: L("About") }
                                ]
                            }
                        ]
                    }
                ]
            },
            {
                $tag: "main",
                childs: [
                    {
                        $tag: "section",
                        id: "general",
                        class: "card",
                        role: "tabpanel",
                        childs: [
                            {
                                $tag: "div",
                                class: "field",
                                childs: [
                                    {
                                        $tag: "div",
                                        class: "label",
                                        childs: [
                                            { $tag: "span", class: "title", text: L("Language") },
                                            { $tag: "span", class: "desc", text: L(
                                                
                                            ) }
                                        ]
                                    },
                                    {
                                        $tag: "div",
                                        class: "custom-select",
                                        childs: [
                                            {
                                                $tag: "select",
                                                id: "langSelect",
                                                childs: [
                                                    {
                                                        $tag: "option",
                                                        value: "fr",
                                                        text: "FR"
                                                    },
                                                    {
                                                        $tag: "option",
                                                        value: "es",
                                                        text: "ES"
                                                    },
                                                    {
                                                        $tag: "option",
                                                        value: "en",
                                                        text: "EN"
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                $tag: "div",
                                class: "field",
                                childs: [
                                    {
                                        $tag: "div",
                                        class: "label",
                                        childs: [
                                            { $tag: "span", class: "title", text: L("Auto update") },
                                            { $tag: "span", class: "desc", text: L("Vérifier automatiquement les mises à jour") }
                                        ]
                                    },
                                    {
                                        $tag: "div",
                                        class: "toggle",
                                        id: "autoToggle",
                                        tabindex: "0",
                                        role: "switch",
                                        "aria-checked": "true",
                                        childs: [
                                            { $tag: "div", class: "knob" }
                                        ]
                                    }
                                ]
                            },
                            {
                                $tag: "div",
                                class: "field",
                                childs: [
                                    {
                                        $tag: "div",
                                        class: "label",
                                        childs: [
                                            { $tag: "span", class: "title", text: L("Icons") },
                                            { $tag: "span", class: "desc", text: L("L'icône d'onglet") }
                                        ]
                                    },
                                    {
                                        $tag: "table",
                                        "aria-describedby": "icon-table-desc",
                                        childs: [
                                            {
                                                $tag: "thead",
                                                childs: [
                                                    {
                                                        $tag: "tr",
                                                        childs: Array.from({ length: 10 }, (_, i) => ({ $tag: "th", text: "#" + i }))
                                                    }
                                                ]
                                            },
                                            {
                                                $tag: "tbody",
                                                id: "iconTableBody"
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                $tag: "div",
                                class: "field",
                                childs: [
                                    {
                                        $tag: "div",
                                        class: "label",
                                        childs: [
                                            { $tag: "span", class: "title", text: L("Maître") },
                                            { $tag: "span", class: "desc", text: L("Sélectionnez le Maître") }
                                        ]
                                    },
                                    {
                                        $tag: "div",
                                        class: "custom-select",
                                        childs: [
                                            {
                                                $tag: "select",
                                                id: "masterSelect",
                                                childs: Array.from({ length: 10 }, (_, i) => ({
                                                    $tag: "option",
                                                    value: i + "",
                                                    text: "#" + i
                                                }))
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                $tag: "div",
                                class: "field",
                                childs: [
                                    {
                                        $tag: "div",
                                        class: "label",
                                        childs: [
                                            { $tag: "span", class: "title", text: L("Auto Listen") },
                                            { $tag: "span", class: "desc", text: L("écoute automatique des processus Dofus") }
                                        ]
                                    },
                                    {
                                        $tag: "div",
                                        class: "toggle",
                                        id: "auto_listen",
                                        tabindex: "0",
                                        role: "switch",
                                        "aria-checked": "true",
                                        childs: [{ $tag: "div", class: "knob" }]
                                    }
                                ]
                            },
                            {
                                $tag: "div",
                                class: "field",
                                childs: [
                                    {
                                        $tag: "div",
                                        class: "label",
                                        childs: [
                                            { $tag: "span", class: "title", text: L("Auto Hide") },
                                            { $tag: "span", class: "desc", text: L("Masquer automatiquement les fenêtres de jeu ouvertes") }
                                        ]
                                    },
                                    {
                                        $tag: "div",
                                        class: "toggle",
                                        id: "auto_hide",
                                        tabindex: "0",
                                        role: "switch",
                                        "aria-checked": "true",
                                        childs: [{ $tag: "div", class: "knob" }]
                                    }
                                ]
                            },
                            {
                                $tag: "div",
                                class: "field",
                                childs: [
                                    {
                                        $tag: "div",
                                        class: "label",
                                        childs: [
                                            { $tag: "span", class: "title", text: L("Window pos") },
                                            { $tag: "span", class: "desc", text: L("Position de départ de l'application") }
                                        ]
                                    },
                                    {
                                        $tag: "div",
                                        class: "custom-select",
                                        childs: [
                                            {
                                                $tag: "select",
                                                id: "core_start_pos",
                                                childs: [
                                                    { $tag: "option", value: "center", text: L("Centre") },
                                                    { $tag: "option", value: "center-right", text: L("Centre droit") },
                                                    { $tag: "option", value: "center-left", text: L("Centre gauche") },
                                                    { $tag: "option", value: "top-center", text: L("Centre supérieur") },
                                                    { $tag: "option", value: "top-right", text: L("En haut à droite") },
                                                    { $tag: "option", value: "top-left", text: L("En haut à gauche") }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        $tag: "section",
                        id: "game",
                        class: "card",
                        role: "tabpanel",
                        childs: [
                            {
                                $tag: "div",
                                class: "field",
                                childs: [
                                    {
                                        $tag: "div",
                                        class: "label",
                                        childs: [
                                            { $tag: "span", class: "title", text: L("Replay mouse wait") },
                                            { $tag: "span", class: "desc", text: L("Délai de répétition de la souris") }
                                        ]
                                    },
                                    {
                                        $tag: "div",
                                        class: "custom-select",
                                        childs: [
                                            {
                                                $tag: "select",
                                                id: "replay_mouse_wait",
                                                childs: [
                                                    { $tag: "option", value: "r", text: L("Random") },
                                                    { $tag: "option", value: "number", text: L("Custom…") }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                $tag: "div",
                                class: "field",
                                childs: [
                                    {
                                        $tag: "div",
                                        class: "label",
                                        childs: [
                                            { $tag: "span", class: "title", text: L("Replay keyboard wait") },
                                            { $tag: "span", class: "desc", text: L("Délai de répétition clavier") }
                                        ]
                                    },
                                    {
                                        $tag: "div",
                                        class: "custom-select",
                                        childs: [
                                            {
                                                $tag: "select",
                                                id: "replay_keyboard_wait",
                                                childs: [
                                                    { $tag: "option", value: "r", text: L("Random") },
                                                    { $tag: "option", value: "number", text: L("Custom…") }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                $tag: "div",
                                class: "field",
                                childs: [
                                    {
                                        $tag: "div",
                                        class: "label",
                                        childs: [
                                            { $tag: "span", class: "title", text: L("Rect margin X") },
                                            { $tag: "span", class: "desc", text: L("Marge horizontale du rectangle aléatoire") }
                                        ]
                                    },
                                    {
                                        $tag: "input",
                                        id: "random_click_rect_margin_x",
                                        type: "number",
                                        value: "50",
                                        style: "width:80px;background:#1c1a3f;border-radius:8px;border:1px solid rgba(255,255,255,0.03);color:#fff;padding:6px 8px;"
                                    }
                                ]
                            },
                            {
                                $tag: "div",
                                class: "field",
                                childs: [
                                    {
                                        $tag: "div",
                                        class: "label",
                                        childs: [
                                            { $tag: "span", class: "title", text: L("Rect margin Y") },
                                            { $tag: "span", class: "desc", text: L("Marge verticale du rectangle aléatoire") }
                                        ]
                                    },
                                    {
                                        $tag: "input",
                                        id: "random_click_rect_margin_y",
                                        type: "number",
                                        value: "30",
                                        style: "width:80px;background:#1c1a3f;border-radius:8px;border:1px solid rgba(255,255,255,0.03);color:#fff;padding:6px 8px;"
                                    }
                                ]
                            },
                            ...[
                                [L("Replay keyboard"), L("Rejouer les actions clavier"), "replay_keyboard"],
                                [L("Frame capture"), L("Capture d’image activée"), "frame_capture_enabled"],
                                [L("Fight ready all"), L("Prêt automatique pour tous"), "fight_ready_all"],
                                [L("Show turn time"), L("Afficher le temps de tour"), "fight_show_turn_time"],
                                [L("Auto turn window"), L("Fenêtre automatique de tour"), "fight_auto_turn_window"],
                                [L("Prevent inactivity"), L("Empêcher l’inactivité du personnage"), "prevent_inactivity"],
                                [L("Auto accept exchange request"), L("Accepter automatiquement les demandes d’échange"), "auto_accept_exchange_request"],
                                [L("Auto accept exchange"), L("Accepter automatiquement l’échange"), "auto_accept_exchange"],
                                [L("Auto accept group invite"), L("Accepter automatiquement les invitations de groupe"), "auto_accept_group_invite"]
                            ].map(entry => ({
                                $tag: "div",
                                class: "field",
                                childs: [
                                    {
                                        $tag: "div",
                                        class: "label",
                                        childs: [
                                            { $tag: "span", class: "title", text: entry[0] },
                                            { $tag: "span", class: "desc", text: entry[1] }
                                        ]
                                    },
                                    {
                                        $tag: "div",
                                        class: "toggle",
                                        id: entry[2],
                                        tabindex: "0",
                                        role: "switch",
                                        "aria-checked": "true",
                                        childs: [{ $tag: "div", class: "knob" }]
                                    }
                                ]
                            }))
                        ]
                    },
                    versionSection
                ]
            }
        ]
    });

    SettingsPage.append("div", {
        class: "modal-backdrop",
        id: "modalBackdrop",
        role: "dialog",
        "aria-modal": "true",
        "aria-hidden": "true",
        childs: [
            {
                $tag: "div",
                class: "modal",
                role: "document",
                "aria-labelledby": "modalTitle",
                childs: [
                    {
                        $tag: "header",
                        childs: [
                            {
                                $tag: "div",
                                childs: [
                                    { $tag: "div", id: "modalTitle", style: "font-weight:700", text: L("Choose an icon") },
                                    { $tag: "div", class: "muted", style: "font-size:13px", text: L("Pick one from the gallery below") }
                                ]
                            },
                            {
                                $tag: "div",
                                childs: [
                                    { $tag: "button", class: "btn", id: "modalClose", text: L("Close") }
                                ]
                            }
                        ]
                    },
                    { $tag: "div", class: "icon-grid", id: "iconGallery", tabindex: "0" },
                    {
                        $tag: "div",
                        style: "display:flex;justify-content:flex-end;margin-top:12px",
                        childs: [
                            { $tag: "button", class: "btn", id: "modalCancel", text: L("Cancel") }
                        ]
                    }
                ]
            }
        ]
    });

    SettingsPage.render();


    const closeBtn = document.querySelector(".icon-close");
    closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        window.appContext && window.appContext.hideSettings();
    });
    
    function updateSettings(key, val) {
        return window.appContext.updateSettings(key, val);
    }

    function disableToggle(id, disabled = true) {
        const toggle = document.getElementById(id);
        disabled ? toggle.classList.add('disabled') : toggle.classList.remove('disabled');
    }

    function disableCaptureFeatures(isON = true) {
        disableToggle('fight_show_turn_time', !isON);
        disableToggle('fight_auto_turn_window', !isON);
        disableToggle('prevent_inactivity', !isON);
        disableToggle('auto_accept_exchange_request', !isON);
        disableToggle('auto_accept_exchange', !isON);
        disableToggle('auto_accept_group_invite', !isON);
        disableToggle('fight_ready_all', !isON);
    }

    const initialRows = settings.icons.map(icon => ({ icon }));

    const tbody = document.getElementById('iconTableBody');

    function renderRows() {
        tbody.innerHTML = '<tr>' + (
            initialRows.map((r, i) => {
                return `
          <td><button class="icon-btn" data-row="${i}" aria-label="${L("Change icon")}"><img style="width: 100%; height: 100%;" src="../avatar/${r.icon}"></img></button></td>
        `;
            }).join("\n")) + '</tr>';
    }

    renderRows();

    document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false') });
            btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
            const target = btn.dataset.target;
            document.querySelectorAll('[role="tabpanel"]').forEach(panel => {
                if (panel.id === target) { panel.style.display = 'block'; panel.setAttribute('aria-hidden', 'false') }
                else { panel.style.display = 'none'; panel.setAttribute('aria-hidden', 'true') }
            })
        })
    });

    document.querySelectorAll(".toggle").forEach((toggle) => {
        const ID = toggle.id;
        toggle.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();

            if (e.target.classList.contains('disabled')) {
                return;
            }

            var isOn;
            if (isOn = e.target.classList.contains('on')) {
                e.target.classList.remove('on');
                isOn = false;
            }
            else {
                e.target.classList.add('on');
                isOn = true;
            }

            if (ID == 'frame_capture_enabled') {
                disableCaptureFeatures(isOn);
            }

            updateSettings(ID, isOn);
        });
        const isON = settings[ID] == true;
        isON ? toggle.classList.add('on') : toggle.classList.remove('on')

        if (ID == 'frame_capture_enabled') {
            disableCaptureFeatures(isON);
        }
    });

    const windowPositions = [
        "center", "center-right", "center-left", "top-center", "top-right", "top-left"
    ];

    const langsPositions = [
        "fr", "es", "en"
    ];

    const modal = document.getElementById('modalBackdrop');
    const modalClose = document.getElementById('modalClose');
    const modalCancel = document.getElementById('modalCancel');
    const gallery = document.getElementById('iconGallery');
    const masterSelect = document.getElementById("masterSelect");
    const langSelect = document.getElementById("langSelect");
    const windowPosSelect = document.getElementById('core_start_pos');
    const externals = document.querySelector('.externals').querySelectorAll('a');

    masterSelect.value = settings.master_index.toString();
    masterSelect.selectedIndex = settings.master_index;
    masterSelect.dispatchEvent(new Event('change'));

    windowPosSelect.value = settings.core_start_pos;
    windowPosSelect.selectedIndex = windowPositions.indexOf(settings.core_start_pos);
    windowPosSelect.dispatchEvent(new Event('change'));

    langSelect.value = settings.lang.toString();
    langSelect.selectedIndex = langsPositions.indexOf(settings.lang);
    langSelect.dispatchEvent(new Event('change'));

    masterSelect.addEventListener('change', function (e) {
        updateSettings('master_index', parseInt(e.target.value));
    });

    windowPosSelect.addEventListener('change', function (e) {
        updateSettings('core_start_pos', e.target.value);
    });

    langSelect.addEventListener('change', function (e) {
        if (e.target.value != settings.lang) {
            updateSettings('lang', e.target.value);
            window.renderSettings();
        }
    });

    let activeRowIndex = null;

    function renderGallery() {
        gallery.innerHTML = '';
        settings.avatars.forEach(ic => {
            const btn = document.createElement('button');
            btn.className = 'icon-tile';
            btn.type = 'button';
            btn.innerHTML = `<img style="width: 100%; height: 100%;" src="../avatar/${ic}"></img>`;
            btn.addEventListener('click', () => {
                if (activeRowIndex !== null) {
                    initialRows[activeRowIndex].icon = ic;
                    renderRows();
                    closeModal();
                    updateSettings('icons', initialRows.map(s => s.icon));
                }
            })
            gallery.appendChild(btn);
        })
    }
    renderGallery();

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.icon-btn');
        if (!btn) return;
        activeRowIndex = Number(btn.dataset.row);
        openModal();
    });

    function openModal() {
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        const first = gallery.querySelector('.icon-tile');
        if (first) first.focus();
    }

    function closeModal() {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        activeRowIndex = null;
    }
    modalClose.addEventListener('click', closeModal);
    modalCancel.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    })

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') closeModal();
    })

    document.querySelectorAll('[role="tab"]').forEach(t => {
        t.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
                const idx = tabs.indexOf(e.target);
                const next = e.key === 'ArrowRight' ? tabs[(idx + 1) % tabs.length] : tabs[(idx - 1 + tabs.length) % tabs.length];
                next.focus();
                next.click();
            }
        })
    })

    function setupRandomOrCustom(id, defaultValue = 0) {
        const select = document.getElementById(id);

        const wrapper = document.createElement("div");
        wrapper.style.display = "none";
        wrapper.style.display = "inline-flex";
        wrapper.style.alignItems = "center";
        wrapper.style.gap = "6px";

        const input = document.createElement("input");
        input.type = "number";
        input.value = defaultValue;
        input.style.width = "95px";
        input.style.background = "#1c1a3f";
        input.style.borderRadius = "8px";
        input.style.border = "1px solid rgba(255,255,255,0.03)";
        input.style.color = "#fff";
        input.style.padding = "6px 8px";
        input.id = `_${id}`;

        input.addEventListener('change', function (e) {
            updateSettings(e.target.id.slice(1), e.target.value);
        });

        const resetBtn = document.createElement("button");
        resetBtn.textContent = "×";
        resetBtn.style.width = "28px";
        resetBtn.style.height = "28px";
        resetBtn.style.borderRadius = "6px";
        resetBtn.style.border = "none";
        resetBtn.style.cursor = "pointer";
        resetBtn.style.fontSize = "18px";
        resetBtn.style.background = "rgba(255,255,255,0.08)";
        resetBtn.style.color = "#fff";

        wrapper.appendChild(input);
        wrapper.appendChild(resetBtn);

        select.parentElement.appendChild(wrapper);

        function showCustom(val = undefined) {
            select.style.display = "none";
            wrapper.style.display = "inline-flex";
            input.value = val || defaultValue;
        }

        function showRandom() {
            wrapper.style.display = "none";
            select.value = "r";
            select.style.display = "inline-block";
            updateSettings(id, 'r');
        }

        function setupSelect() {
            if (select.value === "number") showCustom();
            else showRandom(defaultValue);
        }

        select.addEventListener("change", setupSelect);
        resetBtn.addEventListener("click", showRandom);

        if (settings[id] == 'r') {
            showRandom()
        }
        else {
            showCustom(settings[id]);
        }
    }

    setupRandomOrCustom("replay_mouse_wait", 50);
    setupRandomOrCustom("replay_keyboard_wait", 30);

    for (let _input of document.querySelectorAll('input')) {
        _input.addEventListener('change', function (e) {
            if (e.target.id.slice(1) == "replay_mouse_wait" ||
                e.target.id.slice(1) == "replay_keyboard_wait") {
                return;
            }
            updateSettings(e.target.id, e.target.value);
        });
        if (settings[_input.id]) {
            _input.value = settings[_input.id];
        }
    }

    for (let external of externals) {
        external.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            return window.appContext.openExternalUrl(e.currentTarget.getAttribute('url'));
        })
    }

    document.querySelector('header').addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.isDragging = true;
        window.lastX = e.screenX;
        window.lastY = e.screenY;
    });

    window.addEventListener('mousemove', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!window.isDragging) return;

        const dx = e.screenX - lastX;
        const dy = e.screenY - lastY;
        window.lastX = e.screenX;
        window.lastY = e.screenY;
        window.appContext.moveWindow(dx, dy);
    });

    window.addEventListener('mouseup', () => {
        window.isDragging = false;
    });
})();