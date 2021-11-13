import json
from awscrt import mqtt
from util import full_stack
from functools import partial

class StatefulModule():
    def __init__(self, island):
        self.island = island
        self.lastReceived = 0
        self.lastShadowUpdate = 0
        self.enabled = False

    def enable(self):
        pass

    def disable(self):
        pass

    def update_shadow(self, state):
        [desired, reported] = self.decode_state(state)
        if desired != reported:
            payload = { "state": { "reported": desired } }
            print("Updating shadow state.")
            print("payload", payload)
            payload = json.dumps(payload)
            self.island.iot.publish(topic=self.island.SHADOW_UPDATE_TOPIC, payload=payload, qos=mqtt.QoS.AT_LEAST_ONCE)
            print("Updated shadow state.")

    def extract_sub_state(self, payload, payloadKey):
        [desired, reported] = self.decode_state(payload)
        return desired[self.stateKey][payloadKey]

    def handle_sub_state(self, payload, payloadKey):
        [desired, reported] = self.decode_state(payload)
        print("desired", json.dumps(desired))

        try:
            if desired[self.stateKey][payloadKey].lower() == "true":
                if self.enabled:
                    print("Would enable", self.stateKey, "but it's already enabled.")
                    return
                print("Enabling", self.stateKey, "module.")
                try:
                    self.enable()
                    print("Enabled", self.stateKey, "module.")
                except Exception as err:
                    print("Failed to enable", self.stateKey, "module: " + full_stack())

            elif desired[self.stateKey][payloadKey].lower() == "false":
                if not self.enabled:
                    print("Would disable", self.stateKey, "but it's already disabled.")
                    return
                print ("Disabling", self.stateKey, "module.")
                try:
                    self.disable()
                    print("Disabled", self.stateKey, "module.")
                except Exception as err:
                    print("Failed to disable", self.stateKey, "module: " + full_stack())
            else:
                raise ValueError("Enable should be a stringified boolean.")
        except TypeError:
            raise TypeError("Desired state key '" + self.stateKey + "' should be an object, but is instead " + str(type(desired[self.stateKey])))
        except KeyError:
            pass

    def decode_state(self, mqttMessage):
        payload = json.loads(mqttMessage.decode())
        if (payload["timestamp"] <= self.lastShadowUpdate):
             raise ValueError("Received old message; disregarding.")
        try:
            desired = payload["state"]["desired"]
            reported = payload["state"]["reported"]
        except KeyError as e:
            desired = payload["state"]
            reported = None
        except Error as e:
            print("Failed to decode state for " + self.stateKey + ".")
            print(e)
            print(json.dumps(payload, sort_keys=True, indent=4))
            desired = payload["state"]
            reported = None
        return (desired, reported)

    def decode_message(self, mqttMessage, lastReceived, key):
        payload = json.loads(mqttMessage.decode())
        print(payload)
        if (payload["timestamp"] <= self.lastReceived):
             raise ValueError("Received old message; disregarding.")
        message = payload["payload"]
        self.lastSent = payload["timestamp"]
        return message

    def should_update(self, desired, reported):
        if reported != desired:
            self.update(desired, reported)

    def update(self, desired, reported):
        pass

class DataEmittingModule(StatefulModule):
    def __init__(self, island):
        super().__init__(island)

    def schedule(self, action, time, priority=1):
        action()
        self.scheduledEvent = self.island.scheduler.enter(time, priority, partial(self.schedule, action, time))

class EventRespondingModule(StatefulModule):
    def __init__(self, island):
        super().__init__(island)

