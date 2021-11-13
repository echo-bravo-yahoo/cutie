from awscrt import mqtt
import json
from module import DataEmittingModule

# these should be dynamic
LOCATION = "den"
MODULE_NAME = "weather"

PUBLISH_TOPIC = "data/" + MODULE_NAME + "/" + LOCATION

class Weather(DataEmittingModule):
    def __init__(self, island):
        super().__init__(island)
        self.stateKey = "weather"

        # You will usually have to add an offset to account for the temperature of
        # the sensor. This is usually around 5 degrees but varies by use. Use a
        # separate temperature sensor to calibrate this one.
        self.temperature_offset = -5

    def handle_state(self, payload):
        self.handle_sub_state(payload, "enable")
        # TODO: This is bad. It should handle the odd edge case of being asked to enter a state it can't better
        # Right now it just claims it entered that state, regardless of whether it did or not
        self.update_shadow(payload)

    # this must be idempotent; it'll be called repeatedly, and we only want to instantiate one sensor
    def enable(self):
        # Use virtual to test iot functionality on computers without busio / sensors.
        if not self.island.virtual and not hasattr(self, 'bme680'):
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
        self.schedule(self.publishResults, 60)

    def disable(self):
        if hasattr(self, 'bme680'):
          del self.bme680
        if hasattr(self, 'scheduledEvent'):
          self.island.scheduler.cancel(self.scheduledEvent)

    def publishResults(self):
        print("Publishing results to " + PUBLISH_TOPIC + ".")
        if self.island.virtual:
            print("Running in virtual mode; publishing fake results to " + PUBLISH_TOPIC + ".")

            self.island.iot.publish(topic=PUBLISH_TOPIC, payload=json.dumps({ 'temp': 0, 'gas': 0, 'humidity': 0, 'pressure': 0, 'altitude': 0 }), qos=mqtt.QoS.AT_LEAST_ONCE)
        else:
            self.island.iot.publish(topic=PUBLISH_TOPIC, payload=self.generatePayload(), qos=mqtt.QoS.AT_LEAST_ONCE)

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
