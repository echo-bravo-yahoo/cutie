from AWSIoTPythonSDK.MQTTLib import AWSIoTMQTTClient
import time
import board
from busio import I2C
import adafruit_bme680
import json


myMQTTClient = AWSIoTMQTTClient("badge-and-printer")
myMQTTClient.disableMetricsCollection()
myMQTTClient.configureCredentials("/home/pi/workspace/AmazonRootCA1.pem", "/home/pi/workspace/fbb3f88aee-private.pem.key", "/home/pi/workspace/fbb3f88aee-certificate.pem.crt")
myMQTTClient.configureEndpoint("<redacted-endpoint>", 8883)

myMQTTClient.connect()
# myMQTTClient.subscribe("myTopic", 1, customCallback)
# myMQTTClient.unsubscribe("myTopic")

# Create library object using our Bus I2C port
i2c = I2C(board.SCL, board.SDA)
bme680 = adafruit_bme680.Adafruit_BME680_I2C(i2c, debug=False)

# change this to match the location's pressure (hPa) at sea level
# this could be dynamically updated from, e.g.,
# https://forecast.weather.gov/MapClick.php?x=266&y=134&site=sew&zmx=&zmy=&map_x=266&map_y=134#.X2jtB2hKiUk
bme680.sea_level_pressure = 1013.89

# You will usually have to add an offset to account for the temperature of
# the sensor. This is usually around 5 degrees but varies by use. Use a
# separate temperature sensor to calibrate this one.
temperature_offset = -5

def toFahrenheit(celsius):
    return (celsius * 9/5) + 32

def log(payload):
    print("\nTemperature: %0.1f F" % (payload["temp"]))
    print("Gas: %d ohm" % payload["gas"])
    print("Humidity: %0.1f %%" % payload["humidity"])
    print("Pressure: %0.3f hPa" % payload["pressure"])
    print("Altitude: %0.2f meters" % payload["altitude"])

while True:
    payload = {}
    payload["temp"] = toFahrenheit(bme680.temperature + temperature_offset)
    payload["gas"] = bme680.gas
    payload["humidity"] = bme680.humidity
    payload["pressure"] = bme680.pressure
    payload["altitude"] = bme680.altitude
    myMQTTClient.publish("data/den", json.dumps(payload) , 0)

    log(payload)

    # five minute intervals
    time.sleep(30)

myMQTTClient.disconnect()
