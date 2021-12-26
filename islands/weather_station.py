import os
from awscrt import mqtt
import json
from module import DataEmittingModule

RAIN_PIN = 4
WIND_SPEED_PIN = 25
# WIND_DIRECTION_PIN = 12

# these should be dynamic
LOCATION = "porch"
MODULE_NAME = "weatherStation"

PUBLISH_TOPIC = "data/" + MODULE_NAME + "/" + LOCATION

class WeatherStation(DataEmittingModule):
    def __init__(self, island):
        super().__init__(island)
        self.stateKey = "weatherStation"
        self.rain_fall = 0
        self.wind_speed = 0
        # self.wind_direction = 0

    def handle_state(self, payload):
        self.handle_sub_state(payload, "enable")
        # TODO: This is bad. It should handle the odd edge case of being asked to enter a state it can't better
        # Right now it just claims it entered that state, regardless of whether it did or not
        self.update_shadow(payload)

    # this must be idempotent; it'll be called repeatedly, and we only want to instantiate one sensor
    def enable(self):
        # Use virtual to test iot functionality on computers without busio / sensors.
        if not self.island.virtual and not hasattr(self, 'pi'):
            import pigpio
            self.pi = pigpio.pi()
            self.pi.set_mode(RAIN_PIN, pigpio.INPUT)
            self.pi.set_pull_up_down(RAIN_PIN, pigpio.PUD_DOWN)
            self.pi.set_mode(WIND_SPEED_PIN, pigpio.INPUT)
            self.pi.set_pull_up_down(WIND_SPEED_PIN, pigpio.PUD_DOWN)
            # Note: This doesn't work because it requires an analog pin
            # self.pi.set_mode(WIND_DIRECTION_PIN, pigpio.INPUT)
            # self.pi.set_pull_up_down(WIND_DIRECTION_PIN, pigpio.PUD_DOWN)
            self.rain_callback = self.pi.callback(RAIN_PIN, pigpio.RISING_EDGE)
            self.wind_callback = self.pi.callback(WIND_SPEED_PIN, pigpio.RISING_EDGE)
            # self.wind_direction_callback = self.pi.callback(WIND_DIRECTION_PIN, pigpio.RISING_EDGE)


        # Start the scheduled work
        # This should allow a customizable interval
        self.schedule(self.publishResults, 60)

    def disable(self):
        if hasattr(self, 'bme680'):
          del self.pi
          self.rain_fall = 0
          self.wind_speed = 0
          self.wind_direction = 0
        # This doesn't do anything; should this always call scheduler.cancel?
        # Is that idempotent?
        if hasattr(self, 'scheduledEvent'):
          self.island.scheduler.cancel(self.scheduledEvent)

    def publishResults(self):
        print("Publishing results to " + PUBLISH_TOPIC + ".")
        if self.island.virtual:
            print("Running in virtual mode; did not publish results to " + PUBLISH_TOPIC + ".")
        else:
            self.island.iot.publish(topic=PUBLISH_TOPIC, payload=self.generatePayload(), qos=mqtt.QoS.AT_LEAST_ONCE)

    def generatePayload(self):
        payload = {}
        # .011 inches of rainfall per switch activation
        # When interval becomes customizable, this will need to change to per minute
        payload["rain_fall"] = self.rain_callback.tally() * 0.011
        self.rain_callback.reset_tally()
        self.rain_fall = 0
        # 1.491291 MPH of wind speed per switch activation
        # When interval becomes customizable, this will need to change to per minute
        payload["wind_speed"] = self.wind_callback.tally() * 1.491291
        self.wind_speed = 0
        self.wind_callback.reset_tally()
        # payload["wind_direction"] = ???
        # self.wind_direction = ???
        self.log(payload)
        return json.dumps(payload)

    def log(self, payload):
        print("Rainfall: %0.1f inches" % (payload["rain_fall"]))
        print("Wind speed: %d mph" % payload["wind_speed"])
        # print("Wind direction: %0.1f %%" % payload["wind_direction"])
        print("\n")
