## `cutie` cookbook

This file contains increasingly complex examples (recipes) of how to configure `cutie` for some example use cases.

### MQTT transformations

#### Rebroadcast messages on a given MQTT topic
This recipe listens to all MQTT topics under `alarms` and rebroadcasts them to `notify`.

```javascript
{
  "connections": [
    {
      "type": "connection:mqtt:primary-broker",
      "username": "mqtt_user",
      "password": "mqtt_password",
      "endpoint": "http://127.0.0.1:8087"
    }
  ],
  "tasks": {
    "rebroadcast-alarms": {
      "steps": [
        {
          "type": "input:mqtt:primary-broker",
          "topic": "alarms/+"
        },
        {
          "type": "output:mqtt:primary-broker",
          "topic": "notify"
        }
      ]
    }
  }
}
```

#### Transform and rebroadcast messages
This recipe listens to the MQTT topic `weather/temp`, then rebroadcasts messages  raw to `temp/outside/raw`, then rebroadcasts them in fahrenheit, rounded, to `temp/outside`. This example demonstrates the ability to do partial transformations inbetween outputs.

```javascript
{
  "connections": [
    {
      "type": "connection:mqtt:primary-broker",
      "username": "mqtt_user",
      "password": "mqtt_password",
      "endpoint": "http://127.0.0.1:8087"
    }
  ],
  "tasks": {
    "rebroadcast-temp": {
      "steps": [
        {
          "type": "input:mqtt:primary-broker",
          "topic": "weather/temp"
        },
        {
          "type": "output:mqtt:primary-broker",
          "topic": "temp/outside/raw"
        },
        {
          "type": "transformation:convert",
          "convert": "celsius_to_fahrenheit"
        },
        {
          "type": "transformation:round",
          "precision": 2
        {
          "type": "output:mqtt:primary-broker",
          "topic": "temp/outside"
        }
      ]
    }
  }
}
```
