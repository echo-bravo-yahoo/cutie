from awscrt import mqtt
import json
import os

class AirConditioning:
    def __init__(self, iot, scheduler, sentinel, virtual=False):
        self.iot = iot
        self.virtual = virtual
        self.enabled = False
        self.sentinel = sentinel
        self.lastSent = 0

    def handle_ac_request(self, topic, payload, **kwargs):
        print("Handling ac request")
        if self.virtual:
            print("Running in virtual mode; did not change AC.")
            return
        print(payload.decode())
        res = json.loads(payload.decode())
        if (res["timestamp"] <= self.lastSent):
            return
        command = "node ../bitbang/index.js" + res["cmd"]
        os.system(command)

