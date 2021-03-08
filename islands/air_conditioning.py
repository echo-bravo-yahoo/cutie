from awscrt import mqtt
import json
import os
from module import StatefulModule

class AirConditioning(StatefulModule):
    def __init__(self, island):
        super().__init__(island)
        self.stateKey = "airConditioning"

    def handle_state(self, payload):
        args = {}
        argKeys = ["mode", "temp", "fanMode", "fanSwing", "powerful", "econo", "comfort"]
        for key in argKeys:
            try:
                args[key] = self.extract_sub_state(payload, key)
            except KeyError:
                pass
        if len(list(args.keys())) != len(argKeys):
            print("Invalid AC state; one or more args from the list", str(argKeys), "is missing.")
        else:
            print("Running", "sudo node ../bitbang/index.js" + " --virtual " + str(self.island.virtual) + " --obj '" + json.dumps(args) + "'")
            command = "sudo node ../bitbang/index.js" + " --virtual " + str(self.island.virtual) + " --obj '" + json.dumps(args) + "'"
            os.system(command)
            self.update_shadow(payload)

