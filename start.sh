#!/bin/bash
# CapyBot startup script (used by systemd user service)
export PATH=/home/erick/.local/node/bin:/usr/local/bin:/usr/bin:/bin
cd /home/erick/capybot-tuned || exit 1
exec node dist/bot.js >> bot.log 2>&1
