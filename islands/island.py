from awscrt import mqtt

class Island:
    def __init__(self, config, iot, scheduler, sentinel, virtual=False):
        self.iot = iot
        self.scheduler = scheduler
        self.sentinel = sentinel
        self.virtual = virtual

        self.THING_ID = config["id"]
        self.THING_NAME = config["name"]
        self.SHADOW_UPDATE_TOPIC = "$aws/things/" + self.THING_NAME + "/shadow/update"
        self.SHADOW_UPDATE_ACCEPTED_TOPIC = "$aws/things/" + self.THING_NAME + "/shadow/update/accepted"
        self.SHADOW_UPDATE_REJECTED_TOPIC = "$aws/things/" + self.THING_NAME + "/shadow/update/rejected"
        self.SHADOW_UPDATE_DELTA_TOPIC = "$aws/things/" + self.THING_NAME + "/shadow/update/delta"
        self.SHADOW_GET_TOPIC = "$aws/things/" + self.THING_NAME + "/shadow/get"
        self.SHADOW_GET_ACCEPTED_TOPIC = "$aws/things/" + self.THING_NAME + "/shadow/get/accepted"
        self.SHADOW_GET_REJECTED_TOPIC = "$aws/things/" + self.THING_NAME + "/shadow/get/rejected"

        print("Connecting to IOT.")
        future = self.iot.connect()
        future.result()
        print("Connected to IOT.")

        print("Subscribing to shadow topics.")
        self.iot.subscribe(topic=self.SHADOW_UPDATE_DELTA_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=self.handle_state)
        self.iot.subscribe(topic=self.SHADOW_GET_ACCEPTED_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=self.handle_get_accepted)
        self.iot.subscribe(topic=self.SHADOW_GET_REJECTED_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=self.handle_get_rejected)
        self.iot.subscribe(topic=self.SHADOW_UPDATE_ACCEPTED_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=self.handle_update_accepted)
        self.iot.subscribe(topic=self.SHADOW_UPDATE_REJECTED_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=self.handle_update_rejected)

        print("Requesting new shadow state.")
        self.iot.publish(topic=self.SHADOW_GET_TOPIC, payload="", qos=mqtt.QoS.AT_LEAST_ONCE)
        print("Requested new shadow state.")

    def register_modules(self, modules):
        self.modules = modules

    def handle_state(self, topic, payload, **kwargs):
        print("Received new shadow delta.")
        for module in modules:
            module.handle_state(payload)

    def handle_get_accepted(self, topic, payload, **kwargs):
        print("Received shadow state.")
        for module in self.modules:
            module.handle_state(payload)

    def handle_get_rejected(self, topic, payload, **kwargs):
        print("---ERROR--- Fetching shadow state failed: " + json.dumps(json.loads(payload.decode()), sort_keys=True, indent=4))

    def handle_update_accepted(self, topic, payload, **kwargs):
        print("Updated shadow state.")

    def handle_update_rejected(self, topic, payload, **kwargs):
        print("---ERROR--- Updating shadow state failed: " + json.dumps(json.loads(payload.decode()), sort_keys=True, indent=4))

