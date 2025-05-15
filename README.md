Confirmed to work on node 17

Install to systemctl via `sudo cp ./islands.service /etc/systemd/system/islands.service` and then `sudo systemctl enable islands`

### To-do

- Dynamically adapt to changes in location from MQTT (the application currently doesn't see those changes and continues to emit/subscribe to the old location MQTT topics)

### Logging cookbook

- Pretty logs: `node index.js | pino-pretty`
- Pretty logs for only one tag (in this case, "shadow"): `node index.js | jq 'select(.tags | index( "shadow" ))' | pino-pretty`

### Deploying to a raspi for development

Problems with rsync: no watch daemon
`rsync --recursive --exclude "**/node_modules/*" --exclude "**/.git/*" --exclude "**/config.json"  --exclude "**.png" --exclude "**.zip" --exclude "**.md" --exclude "**/package-lock.json" ~/workspace/islands/ <node>:/home/pi/islands --verbose`

`git stash; git pull; git stash pop; sudo systemctl restart islands; sudo journalctl -u islands --follow`
