from awscrt import mqtt
import json
from util import full_stack

THING_NAME = "badge-and-printer"
# this should be dynamic
LOCATION = "den"
MODULE_NAME = "weather"

SHADOW_UPDATE_TOPIC = "$aws/things/" + THING_NAME + "/shadow/update"
SHADOW_UPDATE_ACCEPTED_TOPIC = "$aws/things/" + THING_NAME + "/shadow/update/accepted"
SHADOW_UPDATE_REJECTED_TOPIC = "$aws/things/" + THING_NAME + "/shadow/update/rejected"
SHADOW_UPDATE_DELTA_TOPIC = "$aws/things/" + THING_NAME + "/shadow/update/delta"
SHADOW_GET_TOPIC = "$aws/things/" + THING_NAME + "/shadow/get"
SHADOW_GET_ACCEPTED_TOPIC = "$aws/things/" + THING_NAME + "/shadow/get/accepted"
SHADOW_GET_REJECTED_TOPIC = "$aws/things/" + THING_NAME + "/shadow/get/rejected"

PUBLISH_TOPIC = "data/" + MODULE_NAME + "/" + LOCATION

class Weather:
    def __init__(self, iot, scheduler, sentinel, virtual=False):
        self.iot = iot
        self.scheduler = scheduler
        self.virtual = virtual
        self.sentinel = sentinel

        # You will usually have to add an offset to account for the temperature of
        # the sensor. This is usually around 5 degrees but varies by use. Use a
        # separate temperature sensor to calibrate this one.
        self.temperature_offset = -5

    def schedule(self):
        self.publishResults()
        self.scheduledEvent = self.scheduler.enter(60, 1, self.schedule)
        self.scheduler.run(False)

    # this must be idempotent; it'll be called repeatedly, and we only want to instantiate one sensor
    def enable(self):
        # Use virtual to test iot functionality on computers without busio / sensors.
        if not self.virtual and not hasattr(self, 'bme680'):
            from busio import I2C
            import adafruit_bme680
            import board

            # Create library object using our Bus I2C port
            i2c = I2C(board.SCL, board.SDA)
            self.bme680 = adafruit_bme680.Adafruit_BME680_I2C(i2c, debug=False)

            # change this to match the location's pressure (hPa) at sea level
            # this could be dynamically updated from, e.g.,
            # https://forecast.weather.gov/MapClick.php?x=266&y=134&site=sew&zmx=&zmy=&map_x=266&mapy=134#.X2jtB2hKiUk
            self.bme680.sea_level_pressure = 1013.89

        # Start the scheduled work
        self.schedule()
        self.sentinel.set()

    def disable(self):
        if hasattr(self, 'bme680'):
          del self.bme680
        if hasattr(self, 'scheduledEvent'):
          self.scheduler.cancel(self.scheduledEvent)

    def publishResults(self):
        print("Publishing results to " + PUBLISH_TOPIC + ".")
        if self.virtual:
            print("Running in virtual mode; did not publish results to " + PUBLISH_TOPIC + ".")
        else:
            self.iot.publish(topic=PUBLISH_TOPIC, payload=self.generatePayload(), qos=mqtt.QoS.AT_LEAST_ONCE)

    def generatePayload(self):
        payload = {}
        payload["temp"] = self.toFahrenheit(self.bme680.temperature + self.temperature_offset)
        payload["gas"] = self.bme680.gas
        payload["humidity"] = self.bme680.humidity
        payload["pressure"] = self.bme680.pressure
        payload["altitude"] = self.bme680.altitude
        self.log(payload)
        return json.dumps(payload)

    def toFahrenheit(self, celsius):
        return (celsius * 9/5) + 32

    def log(self, payload):
        print("Temperature: %0.1f F" % (payload["temp"]))
        print("Gas: %d ohm" % payload["gas"])
        print("Humidity: %0.1f %%" % payload["humidity"])
        print("Pressure: %0.3f hPa" % payload["pressure"])
        print("Altitude: %0.2f meters" % payload["altitude"])
        print("\n")

    def update_if_necessary(self, desired, reported):
        print("desired " + str(desired) + ", reported " + str(reported))
        if reported == None or desired["weather"].lower() != reported["weather"].lower():
            payload = '{"state":{"reported":{"weather":"' + desired["weather"] + '"}}}'
            print(payload)
            print("Updating shadow state.")
            self.iot.publish(topic=SHADOW_UPDATE_TOPIC, payload=payload, qos=mqtt.QoS.AT_LEAST_ONCE)

    def handle_state(self, payload):
        print(json.dumps(json.loads(payload), sort_keys=True, indent=4))
        try:
            desired = json.loads(payload)["state"]["desired"]
            reported = json.loads(payload)["state"]["reported"]
        except KeyError:
            desired = json.loads(payload)["state"]
            reported = None

        try:
            if desired["weather"].lower() == "true":
                print("Enabling weather module.")
                try:
                    self.enable()
                    print("Enabled weather module.")
                    self.update_if_necessary(desired, reported)
                except Exception as err:
                    print("Failed to instantiate weather module: " + full_stack())

            elif desired["weather"].lower() == "false":
                print ("Disabling weather module.")
                try:
                    self.disable()
                    print("Disabled weather module.")
                    self.update_if_necessary(desired, reported)
                except Exception as err:
                    print("Failed to instantiate weather module: " + full_stack())
            else:
                raise ValueError("Weather should be a stringified boolean.")
        except KeyError:
            pass

