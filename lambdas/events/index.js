const aws = require('aws-sdk')
const moment = require('moment')
const iot = new aws.IotData({endpoint: '<redacted-endpoint>'})
const { getTaskBlock } = require('./task.js')
const { getWeatherBlock } = require('./weather.js')

async function generateMorningText() {
  const weatherBlockPromise = getWeatherBlock()
  const taskBlockPromise = getTaskBlock()
  let text = ''
  text += `### Good morning, Ashton!\n`
  text += `It's ${moment().format('dddd, MMMM Do')}.\n\n`
  text += `${await weatherBlockPromise}\n`
  text += `#### To-do:\n`
  text += `${await taskBlockPromise}\n\n`
  text += `Remember to check your calendar!`
  return text
}

async function generateEveningText() {
  const taskBlockPromise = getTaskBlock({ work: { limit: 0 }, personal: { limit: 10 } })
  let text = ''
  text += `### Work's over, Ashton!\n`
  text += `#### To-do:\n`
  text += `${await taskBlockPromise}\n\n`
  return text
}

async function generateWeekendText() {
  const taskBlockPromise = getTaskBlock({ work: { limit: 0 }, personal: { limit: 10 } })
  let text = ''
  if ((new Date()).getDay() === 6) {
    text += `### Enjoy your Saturday, Ashton!\n`
  } else {
    text += `### It's Sunday, Ashton!\n`
  }
  text += `#### To-do:\n`
  text += `${await taskBlockPromise}\n\n`
  return text
}

async function generateText(topic) {
  switch(topic) {
    case 'events/morning':
      return generateMorningText()
    case 'events/evening':
      return generateEveningText()
    case 'events/weekend':
      return generateWeekendText()
  }
}

exports.handler = async (event, context, callback) => {
  const payload = { 'timestamp': Date.now(), text: await generateText(event.topic) }
  var params = {
    topic: 'commands/printer',
    payload: JSON.stringify(payload),
    qos: 1
  }

  const promise = new Promise((resolve, reject) => {
    iot.publish(params, function(err, data) {
      if (err) {
        reject(err)
      } else {
        resolve(payload)
      }
    })
  })

  return promise
}

generateText().then(console.log)
