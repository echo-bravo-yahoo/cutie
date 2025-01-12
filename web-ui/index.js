(async () => {
  // libraries
  const express = require('express')

  const path = require('path')
  const AWSXRay = require('aws-xray-sdk')

  // docs: https://aws.github.io/aws-iot-device-sdk-js-v2/node/index.html
  const { mqtt5, iot } = require('aws-iot-device-sdk-v2');
  let builder = iot.AwsIotMqtt5ClientConfigBuilder.newDirectMqttBuilderWithMtlsFromPath(
    "<redacted-endpoint>",
    "./device-cert.pem.crt",
    "./private-key.pem.key",
  );
  let client = new mqtt5.Mqtt5Client(builder.build());
  client.start();

  // config and constructed objects
  const app = module.exports = express()

  // behavior flags
  const trace = false

  // middleware config
  app.use(express.json())
  app.use('/assets', express.static(path.join(__dirname, 'assets')))
  if (trace) app.use(AWSXRay.express.openSegment('islands'))

  app.get('/', function(req, res) {
    res.status(200).sendFile(path.join(__dirname, './app.html'))
  })

  app.post('/thermal-printer', async function(req, res) {
    const args = { topicName: 'commands/printer', payload: JSON.stringify(req.body), qos: 1 }
    const response = await client.publish(args)
    res.status(200).send(response)
  })

  app.get('/toggle/:resourceName', async function(req, res) {
    const TOGGLE = '2'
    const args = { topicName: `cmnd/${req.params.resourceName}/POWER`, payload: TOGGLE, qos: 1 }
    const response = await client.publish(args)
    res.status(200).send(response)
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

    const args = { topicName: '$aws/things/fiji/shadow/update', payload: JSON.stringify({ state: { desired: { airConditioning: input } } }), qos: 1 }
    const response = await client.publish(args)
    res.status(200).send(response)
  })

  // generic method for all MQTT interactions
  app.post(/\/mqtt\/.*/, async (req, res) => {
    console.log(req.path)
    console.log(req.params)
    const args = {
      topicName: req.path.replace(/^\/mqtt\//, ''),
      payload: JSON.stringify(req.body),
      qos: 1,
    }
    const response = await client.publish(args)
    res.status(200).send(response)
  })

  /* istanbul ignore next */
  if (!module.parent) {
    app.listen(8080)
    console.log('Express started on port 8080')
  }

  if (trace) app.use(AWSXRay.express.closeSegment())
})()
