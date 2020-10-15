import requests
from datetime import datetime

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

def get_weather():
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

    results = {}
    results["low"] = min(hourly, key=lambda x:x["temp"])
    results["low"]["time"] = datetime.fromtimestamp(results["low"]["dt"])
    results["high"] = max(hourly, key=lambda x:x["temp"])
    results["high"]["time"] = datetime.fromtimestamp(results["high"]["dt"]).strftime("%-I %p")
    results["perceived_low"] = min(hourly, key=lambda x:x["feels_like"])
    results["perceived_low"]["time"] = datetime.fromtimestamp(results["perceived_low"]["dt"]).strftime("%-I %p")
    results["perceived_high"] = max(hourly, key=lambda x:x["feels_like"])
    results["perceived_high"]["time"] = datetime.fromtimestamp(results["perceived_high"]["dt"]).strftime("%-I %p")
    results["weather"] = sorted(hourly, key=sort_weather, reverse=True)[0]
    results["weather"]["time"] = datetime.fromtimestamp(results["weather"]["dt"]).strftime("%-I %p")
    return results

def ord(n):
    return str(n)+("th" if 4<=n%100<=20 else {1:"st",2:"nd",3:"rd"}.get(n%10, "th"))

def greeting():
    template = "Good morning, Ashton! It's %A, %B {}.\n".format(ord(datetime.now().day()))
    return datetime.now().strftime(template)

def quote():
    return ""

def weather():
    weather = get_weather()
    template = "Today's low will be {:.0f} °F (at {}).\nToday's high will be {:.0f} °F (at {}).\nExpect there to be {} today around {}."
    result = template.format(
        weather["perceived_low"]["temp"],
        weather["perceived_low"]["time"],
        weather["perceived_high"]["temp"],
        weather["perceived_high"]["time"],
        weather["weather"]["weather"][0]["description"],
        weather["weather"]["time"],
    )

    return result

def todo():
    return ""

def reminder():
    return "Remember to check your calendar!\n"

def handle_morning(topic, payload, **kwargs):
    string = ""
    string += greeting()
    string += quote()
    string += weather()
    string += todo()
    string += reminder()
    printer.handle_print_request(topic, string)
