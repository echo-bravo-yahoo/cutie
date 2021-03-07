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

event_loop_group = io.EventLoopGroup(1)
host_resolver = io.DefaultHostResolver(event_loop_group)
client_bootstrap = io.ClientBootstrap(event_loop_group, host_resolver)

with open('./config.json', 'r') as config_file:
    data = config_file.read()
config = json.loads(data)

iot = mqtt_connection_builder.mtls_from_path(
        endpoint="<redacted-endpoint>",
        cert_filepath="/home/swift/workspace/" + config["id"] + "-certificate.pem.crt",
        pri_key_filepath="/home/swift/workspace/" + config["id"] + "-private.pem.key",
        ca_filepath="/home/swift/workspace/AmazonRootCA1.pem",
        client_id=config["name"],
        client_bootstrap=client_bootstrap,
        clean_session=False,
        keep_alive_secs=6)

scheduler = sched.scheduler(time.time, time.sleep)
sentinel = threading.Event()

island = Island(config, iot, scheduler, sentinel, virtual=True)

modules = [
    Weather(island),
    Printer(island),
    AirConditioning(island)
]

island.register_modules(modules)

while (True):
    sentinel.clear()
    scheduler.run()
    sentinel.wait(1)
