const fetch = require('node-fetch')

function sortWeather(hour) {
  const weatherPriority = {
    '7': 600,
    '6': 500,
    '2': 400,
    '5': 300,
    '3': 200,
    '8': 800
  }
  const [first, second, third] = '' + hour.weather[0].id
  return weatherPriority[first] + parseInt(third)*10 + parseInt(second)
}

async function getWeather() {
  const lat = 47.650528
  const lon = -122.375575
  const exclude="minutely,daily,alerts"
  const apiKey = "CENSOREDCENSOREDCENSORED"
  const units = "imperial"
  const uri = `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&exclude=${exclude}&appid=${apiKey}&units=${units}`
  res = await (fetch(uri).then((res) => res.json()))
  const hourly = res.hourly.slice(0, 24)

  const results = {}
  // console.log(hourly.sort((hour, hour2) => hour.temp - hour2.temp).map((hour) => `${hour.temp} at ${hour.dt}`))
  results.low = hourly.sort((hour, hour2) => hour.temp - hour2.temp)[0]
  results.low.time = results.low.dt
  results.high = hourly.sort((hour, hour2) => hour.temp - hour2.temp).pop()
  results.high.time = results.high.dt
  results.perceived_low = hourly.sort((hour, hour2) => hour.feels_like - hour2.feels_like)[0]
  results.perceived_low.time = results.perceived_low.dt
  results.perceived_high = hourly.sort((hour, hour2) => hour.feels_like - hour2.feels_like).pop()
  results.perceived_high.time = results.perceived_high.dt
  results.weather = hourly.sort((hour, hour2) => sortWeather(hour) - sortWeather(hour2)).pop()
  results.weather.time = results.weather.dt
  return results
}

function makeDateString(time) {
  let hour = (new Date(time*1000)).getHours()
  if (hour < 12) {
    return `${hour} AM`
  } else if (hour === 12) {
    return `${hour} PM`
  } else {
    return `${hour % 12} PM`
  }
}

async function getWeatherBlock() {
  const weather = await getWeather()
  let result = ''
  let state = Math.round(weather.perceived_low.temp)
  let time = makeDateString(weather.perceived_low.time)
  result += `Today's low will be ${state}'F\n\t(at ${time}).\n`
  state = Math.round(weather.perceived_high.temp)
  time = makeDateString(weather.perceived_high.time)
  result += `Today's high will be ${state}'F\n\t(at ${time}).\n`
  state = weather.weather.weather[0].description
  time = makeDateString(weather.weather.time)
  result += `Expect there to be ${state} today around ${time}.\n`
  return result
}

exports = module.exports = {
  getWeatherBlock
}
