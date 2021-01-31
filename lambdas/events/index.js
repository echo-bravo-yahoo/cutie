#!/usr/bin/env node

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

// if we aren't in a lambda function (that is, we're running locally):
if (!process.argv[1].includes('/var/runtime')) {
  if (process.argv[2] === 'events/morning' || process.argv[2] === 'morning') {
    generateText('events/morning').then(console.log)
  } else if (process.argv[2] === 'events/evening' || process.argv[2] === 'evening') {
    generateText('events/evening').then(console.log)
  } else if (process.argv[2] === 'events/weekend' || process.argv[2] === 'weekend') {
    generateText('events/weekend').then(console.log)
  } else {
    throw new Error(`Invalid event (${process.argv[2]})! Please invoke like this: index.js events/morning`)
  }
}
