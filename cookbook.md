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

### Failures

#### Route a failing step somewhere you will see it

A step that throws no longer takes the node down with it: the failure is logged under that step's own topic and the trigger abandons the message, leaving every other task running. What a config adds on top of that is where those failures go, and what to do about them.

This recipe reads a sensor every five minutes and writes it to InfluxDB. It sends every failure three places: a counter in InfluxDB, a line in a file, and an alert on its own MQTT topic. The sensor read has a rescue of its own, so a reading that fails is replaced by a degraded one rather than dropped.

Four pieces are doing the work:

- `rescue` on the `weather` task names the task to run when any of its steps fails. `rescue` on a step overrides that for that step alone.
- A rescue is handed the message that failed and an `${error...}` namespace: `${error.message}`, `${error.name}`, `${error.task}`, `${error.step}`, and `${error.type}`.
- `control:return` hands a value back. `last-resort` returns a degraded reading, so the chain carries on with it. `on-failure` never returns, so the message it was handed ends there.
- `minVerbosity` and `maxVerbosity` split the log bus by severity, so an error reaches `alerts` and nothing else, and everything below it reaches `logs`.

```json
{
  "connections": [
    {
      "type": "connection:mqtt",
      "name": "broker",
      "endpoint": "mqtt://127.0.0.1:1883"
    },
    {
      "type": "connection:influxdb",
      "name": "metrics",
      "url": "http://127.0.0.1:8086/api/v2/write",
      "organization": "home",
      "bucket": "sensors",
      "token": "an-influxdb-token"
    }
  ],
  "tasks": {
    "weather": {
      "rescue": "on-failure",
      "trigger": {
        "type": "trigger:cron",
        "expression": "*/5 * * * *"
      },
      "steps": [
        {
          "type": "read:bme680",
          "rescue": "last-resort"
        },
        {
          "type": "output:influxdb",
          "connectionName": "metrics",
          "measurement": "weather"
        }
      ]
    },
    "last-resort": {
      "steps": [
        {
          "type": "control:return",
          "value": {
            "temp": null,
            "degraded": "${error.message}"
          },
          "stash": {
            "lastFailure": "${error.message}"
          }
        }
      ]
    },
    "on-failure": {
      "steps": [
        {
          "type": "transform:merge",
          "sources": [
            {
              "failedAt": "${error.step}",
              "because": "${error.message}"
            }
          ]
        },
        {
          "type": "output:file",
          "path": "./failures.jsonl"
        },
        {
          "type": "output:influxdb",
          "connectionName": "metrics",
          "measurement": "cutie_errors",
          "tags": {
            "task": "${error.task}",
            "step": "${error.type}"
          }
        }
      ]
    },
    "alerts": {
      "trigger": {
        "type": "trigger:logs",
        "filters": ["*"],
        "minVerbosity": "error"
      },
      "steps": [
        {
          "type": "output:mqtt",
          "connectionName": "broker",
          "topics": ["cutie/alerts"]
        }
      ]
    },
    "logs": {
      "trigger": {
        "type": "trigger:logs",
        "filters": ["*"],
        "minVerbosity": "info",
        "maxVerbosity": "warn"
      },
      "steps": [
        {
          "type": "output:mqtt",
          "connectionName": "broker",
          "topics": ["cutie/logs"]
        }
      ]
    }
  }
}
```

A rescue that only reports, like `on-failure`, ends the message it was handed: the step that called it produced nothing, so there is nothing to carry on with. A rescue that recovers has to say so with `control:return`, and only what that step names crosses back -- the returned value as the message, and each `stash` key written into the caller's stash. Everything else the rescue stashed stays with the rescue.

### Flow control

#### Branch on a reading, and drop the ones you cannot use

A task's steps run in order, every time. Two `control:` steps change that: `control:stop` ends the chain, and `control:branch` runs another task from inside this one and then carries on.

This recipe reads a BME680 every five minutes and publishes it. A reading whose temperature is not a number is dropped before it reaches the broker, a hot one raises an alert, and every reading that survives is labelled with a comfort band on its way out.

Three things are doing the work:

- `when` is the body of a JavaScript function, read for whether its result is truthy and compiled once when the task registers. It means the same thing in both modules: when this holds, do what the module is named for. Omit it to do that every time.
- `control:stop` consumes the message rather than failing it, so a reading the sensor could not produce leaves no `error` line behind and does not count as handled.
- The branch target decides what comes back, exactly as a rescue does. `heat-alert` falls off its own end, so `weather` carries on with the reading it already had. `label-comfort` ends at a `control:return`, so what that step names replaces the message for the rest of `weather`.

```json
{
  "connections": [
    {
      "type": "connection:mqtt",
      "name": "broker",
      "endpoint": "mqtt://127.0.0.1:1883"
    }
  ],
  "tasks": {
    "weather": {
      "trigger": {
        "type": "trigger:cron",
        "expression": "*/5 * * * *"
      },
      "steps": [
        {
          "type": "read:bme680"
        },
        {
          "type": "control:stop",
          "when": "return typeof message.temperature !== 'number'"
        },
        {
          "type": "control:branch",
          "when": "return message.temperature > 30",
          "task": "heat-alert"
        },
        {
          "type": "control:branch",
          "task": "label-comfort"
        },
        {
          "type": "output:mqtt",
          "connectionName": "broker",
          "topics": ["home/weather"]
        }
      ]
    },
    "heat-alert": {
      "steps": [
        {
          "type": "output:mqtt",
          "connectionName": "broker",
          "topics": ["home/alerts/heat"]
        }
      ]
    },
    "label-comfort": {
      "steps": [
        {
          "type": "transform:javascript",
          "outputType": "object",
          "command": "return { ...message, comfort: message.temperature > 24 ? 'warm' : 'ok' };"
        },
        {
          "type": "control:return"
        }
      ]
    }
  }
}
```

`heat-alert` and `label-comfort` are ordinary tasks. Neither declares a trigger, because nothing starts them except the branch that names them, and neither has to know it is a branch target. `cutie validate` refuses a branch naming a task the config does not declare, and refuses one that leads back to the task it branches from; branches and rescues share one graph, so a loop closed by one of each is refused as well.
