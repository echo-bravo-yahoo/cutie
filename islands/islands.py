#!/usr/bin/env python3

from awscrt import io, mqtt, auth, http
from awsiot import mqtt_connection_builder
import sched, time
from weather import Weather
from printer import Printer
from ac import AC
import json
import threading

event_loop_group = io.EventLoopGroup(1)
host_resolver = io.DefaultHostResolver(event_loop_group)
client_bootstrap = io.ClientBootstrap(event_loop_group, host_resolver)

with open('./config.json', 'r') as config_file:
    data = config_file.read()
    config = json.loads(data)

THING_ID = config["id"]
THING_NAME = config["name"]

iot = mqtt_connection_builder.mtls_from_path(
        endpoint="<redacted-endpoint>",
        cert_filepath="/home/pi/workspace/" + THING_ID + "-certificate.pem.crt",
        pri_key_filepath="/home/pi/workspace/" + THING_ID + "-private.pem.key",
        ca_filepath="/home/pi/workspace/AmazonRootCA1.pem",
        client_id=THING_ID,
        client_bootstrap=client_bootstrap,
        clean_session=False,
        keep_alive_secs=6)

scheduler = sched.scheduler(time.time, time.sleep)
sentinel = threading.Event()

modules = [
    Weather(iot, scheduler, sentinel, virtual=False),
    Printer(iot, scheduler, sentinel, virtual=False),
    # AC(iot, scheduler, sentinel, virtual=False)
]

print("Connecting to IOT.")
iot.connect()
print("Connected to IOT.")

SHADOW_UPDATE_TOPIC = "$aws/things/" + THING_NAME + "/shadow/update"
SHADOW_UPDATE_ACCEPTED_TOPIC = "$aws/things/" + THING_NAME + "/shadow/update/accepted"
SHADOW_UPDATE_REJECTED_TOPIC = "$aws/things/" + THING_NAME + "/shadow/update/rejected"
SHADOW_UPDATE_DELTA_TOPIC = "$aws/things/" + THING_NAME + "/shadow/update/delta"
SHADOW_GET_TOPIC = "$aws/things/" + THING_NAME + "/shadow/get"
SHADOW_GET_ACCEPTED_TOPIC = "$aws/things/" + THING_NAME + "/shadow/get/accepted"
SHADOW_GET_REJECTED_TOPIC = "$aws/things/" + THING_NAME + "/shadow/get/rejected"

def handle_state(topic, payload, **kwargs):
    print("Received new shadow delta.")
    modules[0].handle_state(payload.decode())

def handle_get_accepted(topic, payload, **kwargs):
    print("Received shadow state.")
    modules[0].handle_state(payload.decode())

def handle_get_rejected(topic, payload, **kwargs):
    print("---ERROR--- Fetching shadow state failed: " + json.dumps(json.loads(payload.decode()), sort_keys=True, indent=4))

def handle_update_accepted(topic, payload, **kwargs):
    print("Updated shadow state.")

def handle_update_rejected(topic, payload, **kwargs):
    print("---ERROR--- Updating shadow state failed: " + json.dumps(json.loads(payload.decode()), sort_keys=True, indent=4))

print("Subscribing to shadow topics.")
iot.subscribe(topic=SHADOW_UPDATE_DELTA_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=handle_state)
iot.subscribe(topic=SHADOW_GET_ACCEPTED_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=handle_get_accepted)
iot.subscribe(topic=SHADOW_GET_REJECTED_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=handle_get_rejected)
iot.subscribe(topic=SHADOW_UPDATE_ACCEPTED_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=handle_update_accepted)
iot.subscribe(topic=SHADOW_UPDATE_REJECTED_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=handle_update_rejected)

print("Requesting new shadow state.")
iot.publish(topic=SHADOW_GET_TOPIC, payload="", qos=mqtt.QoS.AT_LEAST_ONCE)
print("Requested new shadow state.")

iot.subscribe(topic="commands/printer", qos=mqtt.QoS.AT_LEAST_ONCE, callback=modules[1].handle_print_request)

while (True):
    print("loop")
    sentinel.clear()
    scheduler.run()
    sentinel.wait(1)
