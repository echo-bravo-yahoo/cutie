#!/usr/bin/env node

import aws from 'aws-sdk'
import moment from 'moment'
const iot = new aws.IotData({endpoint: '<redacted-endpoint>'})
import { getTaskBlock } from './task.js'
import { getBudgetBlock } from './ynab.js'
//import { getWeatherBlock } from 'weather.js'

async function generateMorningText() {
  // const weatherBlockPromise = getWeatherBlock()
  let taskBlockPromise
  try {
    taskBlockPromise = await getTaskBlock('morning')
  } catch (err) {
    console.error(err)
    taskBlockPromise = Promise.resolve('Error fetching tasks.')
  }

  let text = ''
  text += `### Good morning, Ashton!\n`
  text += `It's ${moment().format('dddd, MMMM Do')}.\n\n`
  // text += `${await weatherBlockPromise}\n`
  text += `#### To-do:\n`
  text += `${await taskBlockPromise}\n\n`
  text += `Remember to check your calendar!`
  return text
}

async function generateEveningText() {
  let taskBlockPromise, budgetBlockPromise

  try {
    taskBlockPromise = await getTaskBlock('evening')
  } catch (err) {
    console.error(err)
    taskBlockPromise = Promise.resolve('Error fetching tasks.')
  }

  try {
    budgetBlockPromise = await getBudgetBlock()
  } catch (err) {
    console.error(err)
    budgetBlockPromise = Promise.resolve('Error fetching budget.')
  }

  let text = ''
  text += `### Work's over, Ashton!\n`
  text += `${await budgetBlockPromise}\n`
  text += `#### To-do:\n`
  text += `${await taskBlockPromise}`
  return text
}

async function generateWeekendText() {
  let taskBlockPromise, budgetBlockPromise

  try {
    taskBlockPromise = await getTaskBlock('weekend')
  } catch (err) {
    console.error(err)
    taskBlockPromise = Promise.resolve('Error fetching tasks.')
  }

  try {
    budgetBlockPromise = await getBudgetBlock()
  } catch (err) {
    console.error(err)
    budgetBlockPromise = Promise.resolve('Error fetching budget.')
  }

  let text = ''
  if ((new Date()).getDay() === 6) {
    text += `### Enjoy your Saturday, Ashton!\n`
  } else {
    text += `### It's Sunday, Ashton!\n`
  }
  text += `${await budgetBlockPromise}\n`
  text += `#### To-do:\n`
  text += `${await taskBlockPromise}`
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

export async function handler(event, context, callback) {
  const payload = { timestamp: Date.now(), message: await generateText(event.topic) }
  const mqttTopic = process.env.location ? `commands/printer/${process.env.location}` : 'commands/printer'
  console.log(`Attempting to publish to ${mqttTopic}:\n${JSON.stringify(payload, null, 2)}`)
  const params = {
    topic: mqttTopic,
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
