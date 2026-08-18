## `cutie` cookbook

This file contains increasingly complex examples (recipes) of how to configure `cutie` for some example use cases.

Each recipe is a complete config file. Save one as `cutie.conf.yaml` and run `cutie` to try it. Config files can be JSON or YAML; the examples in `./examples` are the YAML equivalents.

A note on the shape these share: a connection is declared once, given a `name`, and referred to by that name from each step's `connectionName`. The step that starts a task goes in `trigger`, not in `steps` -- `cutie` rejects a trigger listed as a step.

### MQTT transforms

#### Rebroadcast messages on a given MQTT topic

This recipe listens to all MQTT topics under `alarms` and rebroadcasts them to `notify`.

```json
{
  "connections": [
    {
      "type": "connection:mqtt",
      "name": "primary-broker",
      "username": "mqtt_user",
      "password": "mqtt_password",
      "endpoint": "mqtt://127.0.0.1:1883"
    }
  ],
  "tasks": {
    "rebroadcast-alarms": {
      "trigger": {
        "type": "trigger:mqtt",
        "connectionName": "primary-broker",
        "topics": ["alarms/+"]
      },
      "steps": [
        {
          "type": "output:mqtt",
          "connectionName": "primary-broker",
          "topics": ["notify"]
        }
      ]
    }
  }
}
```

#### Transform and rebroadcast messages

This recipe listens to the MQTT topic `weather/temp`, then rebroadcasts messages raw to `temp/outside/raw`, then rebroadcasts them in fahrenheit, rounded, to `temp/outside`. This example demonstrates the ability to do partial transforms inbetween outputs.

It expects `weather/temp` to carry a bare number, such as `21.4712`. Neither `transform:convert` nor `transform:round` names a `path`, so both operate on the whole message; a publisher sending `{"temp": 21.4712}` would need `"path": "temp"` on each of them instead.

```json
{
  "connections": [
    {
      "type": "connection:mqtt",
      "name": "primary-broker",
      "username": "mqtt_user",
      "password": "mqtt_password",
      "endpoint": "mqtt://127.0.0.1:1883"
    }
  ],
  "tasks": {
    "rebroadcast-temp": {
      "trigger": {
        "type": "trigger:mqtt",
        "connectionName": "primary-broker",
        "topics": ["weather/temp"]
      },
      "steps": [
        {
          "type": "output:mqtt",
          "connectionName": "primary-broker",
          "topics": ["temp/outside/raw"]
        },
        {
          "type": "transform:convert",
          "from": "celsius",
          "to": "fahrenheit"
        },
        {
          "type": "transform:round",
          "precision": 2
        },
        {
          "type": "output:mqtt",
          "connectionName": "primary-broker",
          "topics": ["temp/outside"]
        }
      ]
    }
  }
}
```
