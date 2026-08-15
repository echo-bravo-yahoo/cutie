Run any of these with `cutie start --config ./examples/<name>.yaml`.

These are best read in this order:

1. `clock.yaml` introduces tasks, triggers, and messages
2. `remote-clock.yaml` introduces connections
3. `basic-sensors.yaml` introduces reads
4. `json-manipulation.yaml` introduces transforms
5. `interpolation.yaml` introduces the stash
6. `env-interpolation.yaml` reads values from the environment
7. `remote-config.yaml` fetches the config itself from a connection

`remote-clock.yaml` and `remote-config.yaml` need an MQTT broker on `mqtt://127.0.0.1:1883`; the rest run with no hardware and no network.