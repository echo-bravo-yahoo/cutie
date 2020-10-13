import requests
from datetime import datetime

template = "https://api.openweathermap.org/data/2.5/onecall?lat={}&lon={}&exclude={}&appid={}&units={}"
lat = 47.650528
lon = -122.375575
exclude="minutely,daily,alerts"
apikey = "CENSORED"
units = "imperial"
uri = template.format(lat, lon, exclude, apikey, units)
r = requests.get(uri)

# next 24 hours only
hourly = r.json()["hourly"][:24]

low = min(hourly, key=lambda x:x["temp"])
high = max(hourly, key=lambda x:x["temp"])
print("Low of {} at {}.".format(low["temp"], str(datetime.fromtimestamp(low["dt"]).time())))
print("High of {} at {}.".format(high["temp"], str(datetime.fromtimestamp(high["dt"]).time())))

perceived_low = min(hourly, key=lambda x:x["feels_like"])
perceived_high = max(hourly, key=lambda x:x["feels_like"])
print("Perceived low of {} at {}.".format(perceived_low["temp"], str(datetime.fromtimestamp(perceived_low["dt"]).time())))
print("Perceived high of {} at {}.".format(perceived_high["temp"], str(datetime.fromtimestamp(perceived_high["dt"]).time())))

def sort_weather(hour):
    weather_priority = {
        '7': 600,
        '6': 500,
        '2': 400,
        '5': 300,
        '3': 200,
        '8': 800
    }
    (first, second, third) = str(hour["weather"][0]["id"])
    return weather_priority[first] + int(third) * 10 + int(second)

worst_weather = sorted(hourly, key=sort_weather, reverse=True)[0]
print("The worst weather will be {} at {}.".format(worst_weather["weather"][0]["description"], str(datetime.fromtimestamp(worst_weather["dt"]))))
