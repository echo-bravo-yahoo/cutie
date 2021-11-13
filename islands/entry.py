#!/usr/bin/env python3

from awscrt import io, mqtt, auth, http
from awsiot import mqtt_connection_builder
import sched, time
from island import Island
from weather import Weather
from printer import Printer
from air_conditioning import AirConditioning
import json
import threading
import getpass

event_loop_group = io.EventLoopGroup(1)
host_resolver = io.DefaultHostResolver(event_loop_group)
client_bootstrap = io.ClientBootstrap(event_loop_group, host_resolver)

with open('./config.json', 'r') as config_file:
    data = config_file.read()
config = json.loads(data)

def interrupted_handler(connection, error, **kwargs):
    print("Connection interrupted: " + error.name + ": " + error.message)

def resumed_handler(connection, return_code, session_present, **kwargs):
    print("Connection resumed: " + return_code)

iot = mqtt_connection_builder.mtls_from_path(
        endpoint="<redacted-endpoint>",
        cert_filepath="/home/" + getpass.getuser() + "/workspace/" + config["id"] + "-certificate.pem.crt",
        pri_key_filepath="/home/" + getpass.getuser() + "/workspace/" + config["id"] + "-private.pem.key",
        ca_filepath="/home/" + getpass.getuser() + "/workspace/AmazonRootCA1.pem",
        client_id=config["name"],
        client_bootstrap=client_bootstrap,
        clean_session=False,
        ping_timeout_ms=3000,
        keep_alive_secs=1200,
        on_connection_interrupted=interrupted_handler,
        on_connection_resumed=resumed_handler)

scheduler = sched.scheduler(time.time, time.sleep)
sentinel = threading.Event()

island = Island(config, iot, scheduler, sentinel, virtual=False)

modules = [
    Weather(island),
    Printer(island),
    AirConditioning(island)
]

island.register_modules(modules)

# This is really messy, but it works
# Uncomment the print statements to see proof
# Docs on sched: https://docs.python.org/3/library/sched.html
while True:
     # print(time.time())
     # print(scheduler.queue)
     next_event = scheduler.run(False)
     if next_event is not None:
         time.sleep(min(1, next_event))
     else:
         time.sleep(1)
