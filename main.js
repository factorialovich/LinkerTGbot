const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const yaml = require('js-yaml');
require('dotenv').config();

const LOCALES_DIR = './locales';
const DEFAULT_LANG = 'en';
const BOT_LANG = (process.env.BOT_LANG || DEFAULT_LANG).toLowerCase();

let translations = {};

/*

-  [ Linker Chat Bot ] (Telegram)

*     Creator: t.me/factorcode
*     Github: github.com/factorialovich

*     Fallback:
*     "Check README.md (instruction for using bot)"
*     Dont take this project for yourself! Enemy.

*/


const loadYamlSafe = (filePath) => {
    try {
        if (fs.existsSync(filePath)) {
            return yaml.load(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (e) {
        console.error('Error loading YAML locale file:', filePath, e);
    }
    return {};
};

const loadTranslations = () => {
    const ru = loadYamlSafe(`${LOCALES_DIR}/ru.yaml`);
    const en = loadYamlSafe(`${LOCALES_DIR}/en.yaml`);
    translations = {
        ...ru,
        ...en
    };
};

loadTranslations();

const getLangRoot = () => {
    if (translations[BOT_LANG]) return translations[BOT_LANG];
    if (translations[DEFAULT_LANG]) return translations[DEFAULT_LANG];
    return {};
};

const interpolate = (str, vars = {}) => {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/{{\s*([^}]+)\s*}}/g, (_, key) => {
        const val = vars[key.trim()];
        return val !== undefined && val !== null ? String(val) : '';
    });
};

const t = (key, vars = {}) => {
    const langRoot = getLangRoot();
    const fallbackRoot = translations[DEFAULT_LANG] || {};
    const getFrom = (root) => {
        if (!root) return undefined;
        const parts = key.split('.');
        let cur = root;
        for (const p of parts) {
            if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
                cur = cur[p];
            } else {
                return undefined;
            }
        }
        return typeof cur === 'string' ? cur : undefined;
    };

    let str = getFrom(langRoot);
    if (str === undefined && langRoot !== fallbackRoot) {
        str = getFrom(fallbackRoot);
    }
    if (str === undefined) return key;
    return interpolate(str, vars);
};

const token = process.env.BOT_TOKEN;
const adminId = process.env.ADMIN_ID;

if (!token || !adminId) {
    console.error(t('console.missing_env'));
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

let botInfo;
bot.getMe().then(info => {
    botInfo = info;
}).catch(err => {
    console.error(t('console.bot_info_failed'), err);
    process.exit(1);
});

const DATA_PATHS = {
    linkers: './data/linkers.json',
    activeLinks: './data/activeLinks.json',
    chats: './data/chatsList.json',
    initialMessages: './data/initialMessages.json'
};

const loadData = (filePath) => {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (error) {
        console.error(t('console.file_load_error', { file_path: filePath }), error);
    }
    return {};
};

const saveData = (filePath, data) => {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(t('console.file_save_error', { file_path: filePath }), error);
    }
};

let linkers = loadData(DATA_PATHS.linkers);
let activeLinks = loadData(DATA_PATHS.activeLinks);
let chats = loadData(DATA_PATHS.chats);
let initialMessages = loadData(DATA_PATHS.initialMessages);
let userActionStates = {};
const permissionCheckIntervals = {};
const activeTimers = {};

const isChatAdminOrCreator = async (chatId, userId) => {
    if (userId.toString() === adminId) return true;
    try {
        const member = await bot.getChatMember(chatId, userId);
        if (member && (member.status === 'creator' || member.status === 'administrator')) return true;
    } catch (e) {
        try {
            const admins = await bot.getChatAdministrators(chatId);
            if (admins.some(a => a.user && a.user.id === Number(userId))) return true;
        } catch (e2) {}
    }
    return false;
};

const hasPermission = async (chatId, userId) => {
    if (userId.toString() === adminId) return true;
    try {
        const member = await bot.getChatMember(chatId, userId);
        if (member && (member.status === 'creator' || member.status === 'administrator')) return true;
    } catch {}
    const chatKey = String(chatId);
    if (linkers[chatKey] && linkers[chatKey].includes(Number(userId))) return true;
    return false;
};

const formatDuration = (seconds) => {
    if (seconds <= 0) return t('duration.expired');
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const ds = d > 0 ? `${d}${t('duration.days_suffix')} ` : '';
    const hs = h > 0 ? `${h}${t('duration.hours_suffix')} ` : '';
    const ms = m > 0 ? `${m}${t('duration.minutes_suffix')} ` : '';
    const ss = `${s}${t('duration.seconds_suffix')}`;

    return `${ds}${hs}${ms}${ss}`.trim();
};

const generateLinkName = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '#';
    for (let i = 0; i < 7; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

bot.on('new_chat_members', async (msg) => {
    const chatId = msg.chat.id;
    const newMembers = msg.new_chat_members;
    let localBotInfo;
    try {
        localBotInfo = await bot.getMe();
    } catch {
        return;
    }

    if (newMembers.some(member => member.id === localBotInfo.id)) {
        const chatKey = String(chatId);
        if (!chats[chatKey]) {
            chats[chatKey] = { title: msg.chat.title || String(chatId) };
            saveData(DATA_PATHS.chats, chats);
        }

        const welcomeText = t('welcome.group_join', { chat_title: msg.chat.title || String(chatId) });
        const sentMessage = await bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' }).catch(() => {});

        if (sentMessage && sentMessage.message_id) {
            initialMessages[chatKey] = sentMessage.message_id;
            saveData(DATA_PATHS.initialMessages, initialMessages);
        }

        if (permissionCheckIntervals[chatKey]) {
            clearInterval(permissionCheckIntervals[chatKey]);
        }

        permissionCheckIntervals[chatKey] = setInterval(async () => {
            try {
                const member = await bot.getChatMember(chatId, localBotInfo.id);
                if (member && member.status === 'administrator') {
                    clearInterval(permissionCheckIntervals[chatKey]);
                    delete permissionCheckIntervals[chatKey];

                    if (initialMessages[chatKey]) {
                        await bot.deleteMessage(chatId, initialMessages[chatKey]).catch(() => {});
                        delete initialMessages[chatKey];
                        saveData(DATA_PATHS.initialMessages, initialMessages);
                    }

                    const successText = t('welcome.admin_ready');
                    await bot.sendMessage(chatId, successText, { parse_mode: 'Markdown' }).catch(() => {});
                }
            } catch (error) {
                clearInterval(permissionCheckIntervals[chatKey]);
                delete permissionCheckIntervals[chatKey];
            }
        }, 15000);

        setTimeout(() => {
            if (permissionCheckIntervals[chatKey]) {
                clearInterval(permissionCheckIntervals[chatKey]);
                delete permissionCheckIntervals[chatKey];
            }
        }, 3600000);
    }
});

const showAdminPanel = async (chatId) => {
    const currentChats = loadData(DATA_PATHS.chats);
    const chatList = Object.keys(currentChats);
    if (chatList.length === 0) {
        return bot.sendMessage(chatId, t('admin_panel.title_empty'), { parse_mode: 'Markdown' });
    }

    const keyboard = await Promise.all(chatList.map(async id => {
        try {
            const chatInfo = await bot.getChat(id);
            return [{ text: chatInfo.title || `Чат ID: ${id}`, callback_data: `admin_manage_chat_${id}` }];
        } catch {
            delete chats[id];
            saveData(DATA_PATHS.chats, chats);
            return null;
        }
    }));

    await bot.sendMessage(chatId, t('admin_panel.title_choose_chat'), {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard.filter(Boolean) }
    }).catch(() => {});
};

bot.on('message', async (msg) => {
    if (!msg.from) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (msg.chat.type === 'private') {
        if (userId.toString() !== adminId) {
            const privateHelpText = t('private_chat.not_admin_help');
            return bot.sendMessage(chatId, privateHelpText, { parse_mode: 'Markdown' }).catch(() => {});
        }

        const state = userActionStates[userId];
        if (state && msg.text && !msg.text.startsWith('/')) {
            const targetChatId = state.chatId;
            let actionCompleted = false;

            if (state.action === 'awaiting_admin_id' || state.action === 'awaiting_ban_id' || state.action === 'awaiting_unban_id') {
                const targetUserId = msg.text.trim();
                if (isNaN(targetUserId)) {
                    return bot.sendMessage(chatId, t('private_chat.ask_user_id_number')).catch(() => {});
                }

                if (state.action === 'awaiting_admin_id') {
                    userActionStates[userId] = { ...state, action: 'awaiting_admin_title', userIdToPromote: targetUserId };
                    return bot.sendMessage(
                        chatId,
                        t('private_chat.ask_custom_admin_title', { user_id: targetUserId }),
                        { parse_mode: 'Markdown' }
                    ).catch(() => {});
                }

                if (state.action === 'awaiting_ban_id') {
                    try {
                        await bot.banChatMember(targetChatId, targetUserId);
                        await bot.sendMessage(
                            chatId,
                            t('private_chat.user_banned', { user_id: targetUserId }),
                            { parse_mode: 'Markdown' }
                        ).catch(() => {});
                    } catch (e) {
                        await bot.sendMessage(chatId, t('private_chat.ban_failed')).catch(() => {});
                    }
                    actionCompleted = true;
                }

                if (state.action === 'awaiting_unban_id') {
                    try {
                        await bot.unbanChatMember(targetChatId, targetUserId);
                        await bot.sendMessage(
                            chatId,
                            t('private_chat.user_unbanned', { user_id: targetUserId }),
                            { parse_mode: 'Markdown' }
                        ).catch(() => {});
                    } catch (e) {
                        await bot.sendMessage(chatId, t('private_chat.unban_failed')).catch(() => {});
                    }
                    actionCompleted = true;
                }

            } else if (state.action === 'awaiting_admin_title') {
                const customTitle = msg.text.trim();
                const userIdToPromote = state.userIdToPromote;
                try {
                    await bot.promoteChatMember(targetChatId, userIdToPromote, {
                        is_anonymous: false, can_manage_chat: true, can_delete_messages: true,
                        can_manage_video_chats: true, can_restrict_members: true, can_promote_members: false,
                        can_change_info: true, can_invite_users: true, can_post_messages: true,
                        can_edit_messages: true, can_pin_messages: true
                    });
                    await bot.setChatAdministratorCustomTitle(targetChatId, userIdToPromote, customTitle);
                    await bot.sendMessage(
                        chatId,
                        t('private_chat.admin_promoted', { user_id: userIdToPromote, title: customTitle }),
                        { parse_mode: 'Markdown' }
                    ).catch(() => {});
                } catch (e) {
                    await bot.sendMessage(chatId, t('private_chat.admin_promote_failed')).catch(() => {});
                }
                actionCompleted = true;
            }

            if (actionCompleted) {
                delete userActionStates[userId];
                await showAdminPanel(chatId);
            }

        } else if (!msg.text || !msg.text.startsWith('/')) {
            delete userActionStates[userId];
            await showAdminPanel(chatId);
        }
        return;
    }

    if (msg.text && msg.text.toLowerCase().includes('+link')) {
        if (await hasPermission(chatId, userId)) {
            await createInviteLink(msg, '1 30m', true);
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }
    }
});

bot.onText(/^\/start(?:@[\w_]+)?$/i, (msg) => {
    if (msg.chat.type === 'private' && msg.from.id.toString() === adminId) {
        delete userActionStates[msg.from.id];
        showAdminPanel(msg.chat.id);
    }
});

bot.onText(/^\/linker(?:@[\w_]+)?$/i, async (msg) => {
    if (msg.chat.type === 'private') return;
    bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    if (!(await hasPermission(msg.chat.id, msg.from.id))) {
        return bot.sendMessage(msg.chat.id, t('permissions.no_menu_permission')).then(sent => {
            setTimeout(() => bot.deleteMessage(msg.chat.id, sent.message_id).catch(() => {}), 10000);
        }).catch(() => {});
    }
    const menuText = t('commands.linker.menu_title');
    const menuKeyboard = {
        inline_keyboard: [
            [{ text: t('commands.linker.buttons.create_default_full'), callback_data: 'create_link_prompt' }],
            [{ text: t('commands.linker.buttons.create_with_params'), callback_data: 'open_create_with_args' }],
            [{ text: t('commands.linker.buttons.my_links'), callback_data: 'view_my_links' }],
            [{ text: t('commands.linker.buttons.help'), callback_data: 'show_help' }]
        ]
    };
    await bot.sendMessage(msg.chat.id, menuText, { parse_mode: 'Markdown', reply_markup: menuKeyboard }).catch(() => {});
});

bot.onText(/^\/addlinker(?:@[\w_]+)?(?:\s+(.*))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    bot.deleteMessage(chatId, msg.message_id).catch(() => {});

    if (!(await isChatAdminOrCreator(chatId, userId))) {
        return bot.sendMessage(chatId, t('permissions.admin_only_command'), { parse_mode: 'Markdown' }).then(sent => {
            setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 10000);
        }).catch(() => {});
    }

    const rawTarget = (match && match[1]) ? match[1].trim() : '';

    if (!rawTarget) {
        return bot.sendMessage(chatId, t('commands.addlinker.need_id'), { parse_mode: 'Markdown' }).then(sent => {
            setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 10000);
        }).catch(() => {});
    }

    const targetId = rawTarget.replace(/[^\d]/g, '');
    if (!targetId || isNaN(targetId)) {
        return bot.sendMessage(chatId, t('commands.addlinker.invalid_id'), { parse_mode: 'Markdown' }).then(sent => {
            setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 10000);
        }).catch(() => {});
    }

    try {
        const chatKey = String(chatId);
        if (!linkers[chatKey]) linkers[chatKey] = [];
        const numericTarget = Number(targetId);

        if (linkers[chatKey].includes(numericTarget)) {
            return bot.sendMessage(chatId, t('commands.addlinker.already_in_list'), { parse_mode: 'Markdown' }).then(sent => {
                setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 10000);
            }).catch(() => {});
        }

        linkers[chatKey].push(numericTarget);
        saveData(DATA_PATHS.linkers, linkers);

        bot.sendMessage(
            chatId,
            t('commands.addlinker.added', { user_id: numericTarget }),
            { parse_mode: 'Markdown' }
        ).then(sent => {
            setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 10000);
        }).catch(() => {});

    } catch (e) {
        bot.sendMessage(chatId, t('commands.addlinker.error'), { parse_mode: 'Markdown' }).then(sent => {
            setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 10000);
        }).catch(() => {});
    }
});

bot.onText(/^\/dellink(?:@[\w_]+)?(?:\s+(.*))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    bot.deleteMessage(chatId, msg.message_id).catch(() => {});

    if (!(await isChatAdminOrCreator(chatId, userId))) {
        return bot.sendMessage(chatId, t('permissions.admin_only_command'), { parse_mode: 'Markdown' }).then(sent => {
            setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 10000);
        }).catch(() => {});
    }

    const rawTarget = (match && match[1]) ? match[1].trim() : '';

    if (!rawTarget) {
        return bot.sendMessage(chatId, t('commands.dellink.need_id'), { parse_mode: 'Markdown' }).then(sent => {
            setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 10000);
        }).catch(() => {});
    }

    const targetId = rawTarget.replace(/[^\d]/g, '');
    if (!targetId || isNaN(targetId)) {
        return bot.sendMessage(chatId, t('commands.dellink.invalid_id'), { parse_mode: 'Markdown' }).then(sent => {
            setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 10000);
        }).catch(() => {});
    }

    try {
        const chatKey = String(chatId);
        const numericTarget = Number(targetId);

        if (!linkers[chatKey] || !linkers[chatKey].includes(numericTarget)) {
            return bot.sendMessage(chatId, t('commands.dellink.not_in_list'), { parse_mode: 'Markdown' }).then(sent => {
                setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 10000);
            }).catch(() => {});
        }

        linkers[chatKey] = linkers[chatKey].filter(id => id !== numericTarget);
        saveData(DATA_PATHS.linkers, linkers);

        bot.sendMessage(
            chatId,
            t('commands.dellink.removed', { user_id: numericTarget }),
            { parse_mode: 'Markdown' }
        ).then(sent => {
            setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 10000);
        }).catch(() => {});

    } catch (e) {
        bot.sendMessage(chatId, t('commands.dellink.error'), { parse_mode: 'Markdown' }).then(sent => {
            setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 10000);
        }).catch(() => {});
    }
});

bot.onText(/^\/link(?:@[\w_]+)?(?:\s+(.*))?$/i, async (msg, match) => {
    if (msg.chat.type === 'private') return;
    await createInviteLink(msg, match && match[1] ? match[1] : '', false);
    bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
});

const createInviteLink = async (msg, argsText, isSilent) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!(await hasPermission(chatId, userId))) {
        if (!isSilent) await bot.sendMessage(chatId, t('permissions.no_permission')).catch(() => {});
        return;
    }

    const args = (argsText || '').split(/\s+/).filter(Boolean);
    let member_limit;
    let expire_date;

    args.forEach(arg => {
        if (/^\d+$/.test(arg)) {
            member_limit = parseInt(arg, 10);
        } else {
            const timeMatch = arg.match(/^(\d+)([mhdw])$/i);
            if (timeMatch) {
                const value = parseInt(timeMatch[1], 10);
                const unit = timeMatch[2].toLowerCase();
                const now = Math.floor(Date.now() / 1000);
                const timeMap = { 'm': 60, 'h': 3600, 'd': 86400, 'w': 604800 };
                expire_date = now + (value * timeMap[unit]);
            }
        }
    });

    try {
        const inviteLink = await bot.createChatInviteLink(chatId, { expire_date, member_limit });
        const linkName = generateLinkName();

        const linkMessageText = t('commands.link.created', {
            link_name: linkName,
            invite_link: inviteLink.invite_link
        });

        const linkMessage = await bot.sendMessage(chatId, linkMessageText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: t('commands.linker.buttons.revoke'), callback_data: `revoke_link_${linkName}` }]]
            }
        }).catch(() => {});

        const chatKey = String(chatId);
        if (!activeLinks[chatKey]) activeLinks[chatKey] = [];
        const linkData = {
            name: linkName,
            link: inviteLink.invite_link,
            creatorId: userId,
            linkMessageId: linkMessage && linkMessage.message_id ? linkMessage.message_id : null
        };

        if (expire_date) {
            const initialRemaining = expire_date - Math.floor(Date.now() / 1000);
            const timerMessageText = t('commands.link.timer', {
                link_name: linkName,
                time_left: formatDuration(initialRemaining)
            });

            const timerMessage = await bot.sendMessage(chatId, timerMessageText, { parse_mode: 'Markdown' }).catch(() => {});

            if (timerMessage && timerMessage.message_id) {
                const timerMsgId = timerMessage.message_id;

                const serviceMessageListener = async (serviceMsg) => {
                    if (
                        serviceMsg.chat.id === chatId &&
                        serviceMsg.pinned_message &&
                        botInfo && serviceMsg.from.id === botInfo.id &&
                        serviceMsg.pinned_message.message_id === timerMsgId
                    ) {
                        await bot.deleteMessage(chatId, serviceMsg.message_id).catch(() => {});
                        bot.removeListener('message', serviceMessageListener);
                    }
                };

                bot.on('message', serviceMessageListener);
                await bot.pinChatMessage(chatId, timerMsgId, { disable_notification: true }).catch(() => {});

                setTimeout(() => {
                    bot.removeListener('message', serviceMessageListener);
                }, 5000);

                const messageKey = `${chatKey}:${timerMsgId}`;
                linkData.timerMessageId = timerMsgId;
                let lastSentText = '';

                const updateMessage = () => {
                    const remaining = expire_date - Math.floor(Date.now() / 1000);
                    if (remaining <= 0) {
                        clearInterval(activeTimers[messageKey]);
                        delete activeTimers[messageKey];
                        bot.deleteMessage(chatId, linkData.linkMessageId).catch(() => {});
                        bot.unpinChatMessage(chatId, { message_id: timerMsgId }).catch(() => {});
                        bot.deleteMessage(chatId, timerMsgId).catch(() => {});
                        if (activeLinks[chatKey]) {
                            activeLinks[chatKey] = activeLinks[chatKey].filter(l => l.name !== linkName);
                            saveData(DATA_PATHS.activeLinks, activeLinks);
                        }
                        return;
                    }

                    const text = t('commands.link.timer', {
                        link_name: linkName,
                        time_left: formatDuration(remaining)
                    });

                    if (text !== lastSentText) {
                        lastSentText = text;
                        bot.editMessageText(text, {
                            chat_id: chatId,
                            message_id: timerMsgId,
                            parse_mode: 'Markdown',
                        }).catch(err => {
                            if (!err.message || !err.message.includes('message is not modified')) {
                                clearInterval(activeTimers[messageKey]);
                                delete activeTimers[messageKey];
                            }
                        });
                    }
                };
                updateMessage();
                activeTimers[messageKey] = setInterval(updateMessage, 3000);
            }
        }

        activeLinks[chatKey].push(linkData);
        saveData(DATA_PATHS.activeLinks, activeLinks);

    } catch (error) {
        if (!isSilent) await bot.sendMessage(chatId, t('commands.link.generic_error'), { parse_mode: 'Markdown' }).catch(() => {});
    }
};

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id;
    const chatId = msg.chat.id;
    const chatKey = String(chatId);

    if (data === 'show_help') {
        const helpText = t('help.inline_help');
        await bot.editMessageText(helpText, {
            chat_id: chatId,
            message_id: msg.message_id,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: t('commands.linker.buttons.back'), callback_data: 'back_to_main_menu' }]] }
        }).catch(() => {});
    }

    if (data === 'back_to_main_menu' || data === 'create_link_prompt') {
        if (data === 'create_link_prompt') {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: t('help.create_link_prompt_alert'),
                show_alert: false
            }).catch(() => {});
            await createInviteLink(msg, '1 30m', false);
            return;
        }
        const menuText = t('commands.linker.main_menu_title');
        const menuKeyboard = {
            inline_keyboard: [
                [{ text: t('commands.linker.buttons.create_default_short'), callback_data: 'create_link_prompt' }],
                [{ text: t('commands.linker.buttons.my_links'), callback_data: 'view_my_links' }],
                [{ text: t('commands.linker.buttons.help'), callback_data: 'show_help' }]
            ]
        };
        await bot.editMessageText(menuText, {
            chat_id: chatId,
            message_id: msg.message_id,
            parse_mode: 'Markdown',
            reply_markup: menuKeyboard
        }).catch(() => {});
    }

    if (data === 'open_create_with_args') {
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: t('help.open_with_args_alert'),
            show_alert: true
        }).catch(() => {});
    }

    if (data && data.startsWith('revoke_link_')) {
        const linkNameToRevoke = data.replace('revoke_link_', '');
        const linkInfo = (activeLinks[chatKey] || []).find(l => l.name === linkNameToRevoke);

        if (linkInfo && (linkInfo.creatorId === userId || await hasPermission(chatId, userId))) {
            try {
                await bot.revokeChatInviteLink(chatId, linkInfo.link).catch(() => {});

                if (linkInfo.timerMessageId) {
                    const messageKey = `${chatKey}:${linkInfo.timerMessageId}`;
                    clearInterval(activeTimers[messageKey]);
                    delete activeTimers[messageKey];
                    await bot.unpinChatMessage(chatId, { message_id: linkInfo.timerMessageId }).catch(() => {});
                    await bot.deleteMessage(chatId, linkInfo.timerMessageId).catch(() => {});
                }
                if (linkInfo.linkMessageId) {
                    await bot.deleteMessage(chatId, linkInfo.linkMessageId).catch(() => {});
                }

                if (activeLinks[chatKey]) {
                    activeLinks[chatKey] = activeLinks[chatKey].filter(l => l.name !== linkNameToRevoke);
                    saveData(DATA_PATHS.activeLinks, activeLinks);
                }

                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: t('links.revoke_success_alert')
                }).catch(() => {});

                const myLinks = (activeLinks[chatKey] || []).filter(l => l.creatorId === userId);
                if (!myLinks || myLinks.length === 0) {
                    await bot.editMessageText(t('links.none_for_user'), {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        reply_markup: { inline_keyboard: [[{ text: t('commands.linker.buttons.back'), callback_data: 'back_to_main_menu' }]] }
                    }).catch(() => {});
                } else {
                    const keyboard = myLinks.map(link => ([
                        { text: interpolate(t('commands.linker.buttons.link_item'), { link_name: link.name }), callback_data: `noop` },
                        { text: t('commands.linker.buttons.revoke'), callback_data: `revoke_link_${link.name}` }
                    ]));
                    keyboard.push([{ text: t('commands.linker.buttons.back'), callback_data: 'back_to_main_menu' }]);
                    await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, {
                        chat_id: chatId,
                        message_id: msg.message_id
                    }).catch(() => {});
                }

            } catch (error) {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: t('links.revoke_error_alert'),
                    show_alert: true
                }).catch(() => {});
                if (linkInfo && linkInfo.timerMessageId) await bot.deleteMessage(chatId, linkInfo.timerMessageId).catch(() => {});
                if (linkInfo && linkInfo.linkMessageId) await bot.deleteMessage(chatId, linkInfo.linkMessageId).catch(() => {});
                if (activeLinks[chatKey]) {
                    activeLinks[chatKey] = activeLinks[chatKey].filter(l => l.name !== linkNameToRevoke);
                    saveData(DATA_PATHS.activeLinks, activeLinks);
                }
            }
        } else {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: t('permissions.no_revoke_permission'),
                show_alert: true
            }).catch(() => {});
        }
    }

    if (data === 'view_my_links') {
        const myLinks = (activeLinks[chatKey] || []).filter(l => l.creatorId === userId);
        if (!myLinks || myLinks.length === 0) {
            return bot.editMessageText(t('links.none_for_user'), {
                chat_id: chatId,
                message_id: msg.message_id,
                reply_markup: {
                    inline_keyboard: [[{ text: t('commands.linker.buttons.back'), callback_data: 'back_to_main_menu' }]]
                }
            }).catch(() => {});
        }
        const keyboard = myLinks.map(link => ([
            { text: interpolate(t('commands.linker.buttons.link_item'), { link_name: link.name }), callback_data: `noop` },
            { text: t('commands.linker.buttons.revoke'), callback_data: `revoke_link_${link.name}` }
        ]));
        keyboard.push([{ text: t('commands.linker.buttons.back'), callback_data: 'back_to_main_menu' }]);
        await bot.editMessageText(t('links.list_for_user'), {
            chat_id: chatId,
            message_id: msg.message_id,
            reply_markup: { inline_keyboard: keyboard }
        }).catch(() => {});
    }

    if (userId.toString() === adminId) {
        if (data && data.startsWith('admin_manage_chat_')) {
            const targetChatId = data.split('_').slice(3).join('_');
            try {
                const chatInfo = await bot.getChat(targetChatId);
                await bot.editMessageText(
                    t('admin_panel.manage_chat_title', { chat_title: chatInfo.title || targetChatId }),
                    {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: t('admin_panel.buttons.add_admin'), callback_data: `admin_add_admin_${targetChatId}` }],
                                [
                                    { text: t('admin_panel.buttons.ban'), callback_data: `admin_ban_${targetChatId}` },
                                    { text: t('admin_panel.buttons.unban'), callback_data: `admin_unban_${targetChatId}` }
                                ],
                                [{ text: t('admin_panel.buttons.list_linkers'), callback_data: `admin_list_linkers_${targetChatId}` }],
                                [{ text: t('admin_panel.buttons.revoke_all'), callback_data: `admin_revoke_all_${targetChatId}` }],
                                [{ text: t('admin_panel.buttons.back'), callback_data: 'admin_panel' }]
                            ]
                        }
                    }
                ).catch(() => {});
            } catch (e) {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: t('admin_panel.get_chat_failed_alert'),
                    show_alert: true
                }).catch(() => {});
                delete chats[targetChatId];
                saveData(DATA_PATHS.chats, chats);
                await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                await showAdminPanel(chatId);
            }
        }

        if (data && data.startsWith('admin_add_admin_')) {
            const targetChatId = data.split('_').slice(3).join('_');
            userActionStates[userId] = { action: 'awaiting_admin_id', chatId: targetChatId };
            await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            await bot.sendMessage(chatId, t('private_chat.prompt_admin_id')).catch(() => {});
        }

        if (data && data.startsWith('admin_ban_')) {
            const targetChatId = data.split('_').slice(2).join('_');
            userActionStates[userId] = { action: 'awaiting_ban_id', chatId: targetChatId };
            await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            await bot.sendMessage(chatId, t('private_chat.prompt_ban_id')).catch(() => {});
        }

        if (data && data.startsWith('admin_unban_')) {
            const targetChatId = data.split('_').slice(2).join('_');
            userActionStates[userId] = { action: 'awaiting_unban_id', chatId: targetChatId };
            await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            await bot.sendMessage(chatId, t('private_chat.prompt_unban_id')).catch(() => {});
        }

        if (data && data.startsWith('admin_list_linkers_')) {
            const targetChatId = data.split('_').slice(3).join('_');
            const list = linkers[targetChatId] || [];
            if (list.length === 0) {
                await bot.editMessageText(t('linkers_admin.list_empty'), {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    reply_markup: { inline_keyboard: [[{ text: t('commands.linker.buttons.back'), callback_data: `admin_manage_chat_${targetChatId}` }]] }
                }).catch(() => {});
            } else {
                const keyboard = list.map(id => ([
                    { text: interpolate(t('linkers_admin.list_item_label'), { user_id: id }), callback_data: `noop` },
                    { text: t('linkers_admin.remove_button'), callback_data: `admin_remove_linker_${targetChatId}_${id}` }
                ]));
                keyboard.push([{ text: t('commands.linker.buttons.back'), callback_data: `admin_manage_chat_${targetChatId}` }]);
                await bot.editMessageText(t('linkers_admin.list_title'), {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    reply_markup: { inline_keyboard: keyboard }
                }).catch(() => {});
            }
        }

        if (data && data.startsWith('admin_remove_linker_')) {
            const parts = data.split('_');
            const targetChatId = parts[3];
            const targetUserId = Number(parts[4]);
            if (linkers[targetChatId] && linkers[targetChatId].includes(targetUserId)) {
                linkers[targetChatId] = linkers[targetChatId].filter(id => id !== targetUserId);
                saveData(DATA_PATHS.linkers, linkers);
            }
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: t('linkers_admin.remove_linker_done_alert')
            }).catch(() => {});
            await bot.editMessageText(t('linkers_admin.remove_linker_updated_text'), {
                chat_id: chatId,
                message_id: msg.message_id,
                reply_markup: { inline_keyboard: [[{ text: t('commands.linker.buttons.back'), callback_data: `admin_manage_chat_${targetChatId}` }]] }
            }).catch(() => {});
        }

        if (data && data.startsWith('admin_revoke_all_')) {
            const targetChatId = data.split('_').slice(3).join('_');
            const links = activeLinks[targetChatId] || [];
            for (const l of [...links]) {
                try {
                    await bot.revokeChatInviteLink(targetChatId, l.link).catch(() => {});
                    if (l.timerMessageId) {
                        await bot.unpinChatMessage(targetChatId, { message_id: l.timerMessageId }).catch(() => {});
                        await bot.deleteMessage(targetChatId, l.timerMessageId).catch(() => {});
                    }
                    if (l.linkMessageId) await bot.deleteMessage(targetChatId, l.linkMessageId).catch(() => {});
                } catch {}
            }
            activeLinks[targetChatId] = [];
            saveData(DATA_PATHS.activeLinks, activeLinks);
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: t('links.revoke_all_done_alert')
            }).catch(() => {});
            await bot.editMessageText(t('links.revoke_all_text'), {
                chat_id: chatId,
                message_id: msg.message_id,
                reply_markup: { inline_keyboard: [[{ text: t('commands.linker.buttons.back'), callback_data: 'admin_panel' }]] }
            }).catch(() => {});
        }

        if (data === 'admin_panel') {
            delete userActionStates[userId];
            await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            await showAdminPanel(chatId);
        }
    }

    if (!callbackQuery.answered) {
        await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
    }
});

console.log(t('Successful starting'));