# Telegram Linker Bot

A Telegram bot for managing invite links in group chats.  
It allows administrators (and delegated "linkers") to quickly create, revoke and manage invite links with limits and expiration.

## Features

- Create invite links with:
  - Member limit
  - Expiration time (minutes / hours / days / weeks)
- Quick command `+link` for 1 user / 30 minutes
- Link management menu `/linker`
- Per-chat "linker" role (users that can create links without being full admins)
- Admin panel for the global bot owner (by `ADMIN_ID`)
- Multi-language support (Russian / English) via YAML files

## Commands

In group chats:

- `/linker` — open the main link management menu.
- `/link <N> <T><m/h/d/w>` — quickly create a link:
  - Example: `/link 10 1h` — link for 10 users for 1 hour.
- `+link` — quick link for 1 user, 30 minutes.
- `/addlinker <ID>` — add user to the "linkers" list for this chat.
- `/dellink <ID>` — remove user from the "linkers" list for this chat.

In private chat **with the bot owner** (`ADMIN_ID`):

- `/start` — open the global admin panel with chat list.
- From there, you can:
  - Promote admins in a chosen chat
  - Ban / unban users
  - Manage chat linkers
  - Revoke all active links in a chat

## Requirements

- Node.js 16+
- A Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Your Telegram user ID for `ADMIN_ID`

## Installation

```bash
git clone https://github.com/factorialovich/LinkerTGbot.git
cd LinkerTGbot
npm install