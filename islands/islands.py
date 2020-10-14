from awscrt import io, mqtt, auth, http
from awsiot import mqtt_connection_builder
import sched, time
from weather import Weather
from printer import Printer
import json
import threading

event_loop_group = io.EventLoopGroup(1)
host_resolver = io.DefaultHostResolver(event_loop_group)
client_bootstrap = io.ClientBootstrap(event_loop_group, host_resolver)

THING_NAME = "badge-and-printer"

iot = mqtt_connection_builder.mtls_from_path(
        endpoint="<redacted-endpoint>",
        cert_filepath="/home/pi/workspace/fbb3f88aee-certificate.pem.crt",
        pri_key_filepath="/home/pi/workspace/fbb3f88aee-private.pem.key",
        ca_filepath="/home/pi/workspace/AmazonRootCA1.pem",
        client_id=THING_NAME,
        client_bootstrap=client_bootstrap,
        clean_session=False,
        keep_alive_secs=6)

scheduler = sched.scheduler(time.time, time.sleep)

weather = Weather(iot, scheduler, virtual=False)
printer = Printer(iot, virtual=False)

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

def handle_delta(topic, payload, **kwargs):
    print("Received new shadow delta.")
    weather.handle_delta(payload.decode())

def handle_get_accepted(topic, payload, **kwargs):
    print("Received shadow state.")
    weather.handle_delta(payload.decode())

def handle_get_rejected(topic, payload, **kwargs):
    print("---ERROR--- Fetching shadow state failed: " + json.dumps(json.loads(payload.decode()), sort_keys=True, indent=4))

def handle_update_accepted(topic, payload, **kwargs):
    print("Updated shadow state.")

def handle_update_rejected(topic, payload, **kwargs):
    print("---ERROR--- Updating shadow state failed: " + json.dumps(json.loads(payload.decode()), sort_keys=True, indent=4))

print("Subscribing to shadow topics.")
iot.subscribe(topic=SHADOW_UPDATE_DELTA_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=handle_delta)
shadow_get_accepted_future, temp = iot.subscribe(topic=SHADOW_GET_ACCEPTED_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=handle_get_accepted)
iot.subscribe(topic=SHADOW_GET_REJECTED_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=handle_get_rejected)
iot.subscribe(topic=SHADOW_UPDATE_ACCEPTED_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=handle_update_accepted)
iot.subscribe(topic=SHADOW_UPDATE_REJECTED_TOPIC, qos=mqtt.QoS.AT_LEAST_ONCE, callback=handle_update_rejected)

print("Requesting new shadow state.")
iot.publish(topic=SHADOW_GET_TOPIC, payload="", qos=mqtt.QoS.AT_LEAST_ONCE)
print("Requested new shadow state.")

iot.subscribe(topic="commands/printer", qos=mqtt.QoS.AT_LEAST_ONCE, callback=printer.handle_print_request)

sentinel = threading.Event()

scheduler.run()

sentinel.wait()
