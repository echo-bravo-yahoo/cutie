class StatefulModule():
    def __init__(self, iot, scheduler, sentinel, virtual=False):
        self.iot = iot
        self.scheduler = scheduler
        self.virtual = virtual
        self.sentinel = sentinel
        self.lastSent = 0
        self.lastShadowUpdate = 0

    def enable(self):
        pass

    def disable(self):
        pass

    def update_shadow(self, changed):
        print("update_shadow")
        payload = { state: { current: {} } }
        for key in changed.keys():
            payload["state"]["current"][key] = changed[key]
        print("Updating shadow state.")
        self.iot.publish(topic=SHADOW_UPDATE_TOPIC, payload=payload, qos=mqtt.QoS.AT_LEAST_ONCE)
        print("Updated shadow state.")

    # TODO: This doesn't handle updating shadow state afterwards
    def handle_sub_state(self, payload, payloadKey, changed):
        print("handle_sub_state")
        [desired, reported] = decode_state(payload)

        try:
            if desired[self.stateKey][payloadKey].lower() == "true":
                print("Enabling", self.stateKey, "module.")
                try:
                    self.enable()
                    print("Enabled", self.stateKey, "module.")
                    changed[self.stateKey] =  "true"
                    # self.update_if_necessary(desired, current)
                except Exception as err:
                    print("Failed to enable", self.stateKey, "module: " + full_stack())

            elif desired[self.stateKey][payloadKey].lower() == "false":
                print ("Disabling", self.stateKey, "module.")
                try:
                    self.disable()
                    print("Disabled", self.stateKey, "module.")
                    changed[self.stateKey] =  "false"
                    # self.update_if_necessary(desired, current)
                except Exception as err:
                    print("Failed to disable", self.stateKey, "module: " + full_stack())
            else:
                raise ValueError("Enable should be a stringified boolean.")
        except KeyError:
            pass

    def decode_state(self, mqttMessage):
        print("decode_state")
        state = decode_message(mqttMessage, self.lastShadowUpdate)
        try:
            desired = json.loads(payload)["state"]["desired"]
            reported = json.loads(payload)["state"]["desired"]
        except KeyError as e:
            print("Failed to decode state for " + self.stateKey + ".")
            print(e)
            print(json.dumps(json.loads(payload), sort_keys=True, indent=4))
            desired = json.loads(payload)["state"]["desired"]
            reported = None
        return (desired, reported)

    def decode_message(self, mqttMessage, lastReceived):
        print("decode_message")
        if self.virtual:
            raise ValueError("Running in virtual mode; did not process message " + mqttMessage.decode())
        payload = json.loads(mqttMessage.decode())
        print(payload)
        if (res["timestamp"] <= lastReceived):
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
    def __init__(self, iot, scheduler, sentinel, virtual=False):
        super().__init__(iot, scheduler, sentinel, virtual=False)

    def schedule(self, action, time, priority=1):
        print("schedule")
        self.scheduledEvent = self.scheduler.enter(time, priority, self.schedule)
        action()
        self.scheduler.run(False)
        self.sentinel.set()

class EventRespondingModule(StatefulModule):
    def __init__(self, iot, scheduler, sentinel, virtual=False):
        super().__init__(iot, scheduler, sentinel, virtual=False)

