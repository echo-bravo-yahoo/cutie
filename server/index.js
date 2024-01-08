(async () => {
  // libraries
  const express = require('express')
  const { IoTDataPlaneClient, PublishCommand } = require("@aws-sdk/client-iot-data-plane")
  // import { IoTDataPlaneClient, PublishCommand } from "@aws-sdk/client-iot-data-plane"
  const path = require('path')
  const { readFileSync } = require('fs')
  const AWSXRay = require('aws-xray-sdk')


  // config and constructed objects
  const config = require('./config.json')
  const client = new IoTDataPlaneClient(config)
  const app = module.exports = express()

  // behavior flags
  const trace = false

  // middleware config
  app.use(express.json())
  if (trace) app.use(AWSXRay.express.openSegment('MyApp'))

  app.get('/app', function(req, res) {
    res.status(200).sendFile(path.join(__dirname, './app.html'))
  })

  app.post('/thermal-printer', async function(req, res) {
    const args = { topic: 'commands/printer', payload: JSON.stringify(req.body), qos: 1 }
    const command = new PublishCommand(args)
    console.log(args)
    const response = await client.send(command)
    res.status(200).send(response)
  })

  app.get('/lamp/toggle', async function(req, res) {
    const command = new PublishCommand({ topic: 'cmnd/tasmota_9FBD6F/POWER', payload: 'TOGGLE' })
    const response = await client.send(command)
    res.status(200).send(response)
  })

  app.get('/growLights/toggle', async function(req, res) {
    // TODO: Fix these endpoints
    const command1 = new PublishCommand({ topic: 'cmnd/tasmota_9FBD6F/POWER', payload: 'TOGGLE' })
    const command2 = new PublishCommand({ topic: 'cmnd/tasmota_9FBD6F/POWER', payload: 'TOGGLE' })
    const response1 = await client.send(command1)
    const response2 = await client.send(command2)
    res.status(200).send([response1, response2])
  })

  app.get('/thermostat/:desired', async function(req, res) {
    let input = {
      powerful: true,
      econo: false,
      fanMode: 3
    }

    if (req.params.desired === 'coldest') {
      input = {
        mode: 'COLD',
        temp: 68,
        fanSwing: true,
        comfort: false
      }
    } else if (req.params.desired === 'cold') {
      input = {
        mode: 'COLD',
        temp: 70,
        fanSwing: true,
        comfort: false
      }
    } else if (req.params.desired === 'hottest') {
      input = {
        mode: 'HEAT',
        temp: 75,
        fanSwing: false,
        comfort: false
      }
    } else if (req.params.desired === 'hot') {
      input = {
        mode: 'HEAT',
        temp: 72,
        fanSwing: false,
        comfort: true
      }
    } else if (req.params.desired === 'fanOnly') {
      input = {
        mode: 'FAN',
        // temp doesn't matter, but has to be populated
        temp: 70,
        fanSwing: true,
        comfort: true
      }
    } else if (req.params.desired === 'auto') {
      input = {
        mode: 'AUTO',
        temp: 72,
        fanSwing: true,
        comfort: true
      }
    } else if (req.params.desired === 'off') {
      input = {
        mode: 'OFF',
        temp: 72,
        fanSwing: false,
        comfort: true
      }
    } else {
      res.status(400).send({ error: 'Bad input.' })
    }

    const command = new PublishCommand({ topic: '$aws/things/fiji/shadow/update', payload: JSON.stringify({ state: { desired: { airConditioning: input } } }) })
    const response = await client.send(command)
    res.status(200).send(response)
  })

  // generic method for all MQTT interactions
  app.post(/\/mqtt\/.*/, async (req, res) => {
    console.log(req.path)
    console.log(req.params)
    const command = new PublishCommand({
      topic: req.path.replace(/^\/mqtt\//, ''),
      payload: JSON.stringify(req.body)
    })
    const response = await client.send(command)
    res.status(200).send(response)
  })

  /* istanbul ignore next */
  if (!module.parent) {
    app.listen(3009, '0.0.0.0')
    console.log('Express started on port 3009')
  }

  if (trace) app.use(AWSXRay.express.closeSegment())
})()
