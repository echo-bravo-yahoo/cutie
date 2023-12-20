import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const config = require('./config.json')

import { resolve } from 'path'
import { writeFile } from 'node:fs/promises'
import { execSync } from 'child_process'

import { mqtt, iot, iotidentity, iotshadow, io } from 'aws-iot-device-sdk-v2'

export async function createKeysAndRegisterThing() {
    console.log('Connecting...')
    const connection = await buildConnection()
    const identity = new iotidentity.IotIdentityClient(connection)

  const keys = await createKeys(connection, identity)

  const promises = []
  promises.push(writeFile(resolve(`${config.provisioner.iot.awsCertFilePath}`, `../${config.hostname}-certificate.pem.crt`), keys.certificatePem, { mode: 0o600 }))
  promises.push(writeFile(resolve(`${config.provisioner.iot.awsCertFilePath}`, `../${config.hostname}-private.pem.key`), keys.privateKey, { mode: 0o600 }))
  promises.push(writeFile(resolve(`${config.provisioner.iot.awsCertFilePath}`, `../${config.hostname}-certificate-ownership.token`), keys.certificateOwnershipToken, { mode: 0o600 }))
  promises.push(writeFile(resolve(`${config.provisioner.iot.awsCertFilePath}`, `../${config.hostname}-certificate.id`), keys.certificateId, { mode: 0o600 }))
  await Promise.all(promises)

  const enc = new TextDecoder("utf-8");
  const publicKeyText = enc.decode(execSync(`ssh-keygen -y -f ${resolve(`${config.provisioner.iot.awsCertFilePath}`, `../${config.hostname}-private.pem.key`)}`))
  await writeFile(resolve(`${config.provisioner.iot.awsCertFilePath}`, `../${config.hostname}-public.pem.key`), publicKeyText, { mode: 0o600 })

  await registerThing(identity, keys.certificateId, keys.certificateOwnershipToken)

  await createShadow(connection)

  console.log('Disconnecting...')
  await connection.disconnect()

  return { ...keys, publicKey: publicKeyText }
}

async function createShadow(connection) {
  return new Promise(async (resolve, reject) => {
    const shadow = new iotshadow.IotShadowClient(connection)
    try {
      function shadowUpdateAccepted(error, response) {
        if (error || !response) {
          console.log("Error occurred..")
          reject(error)
        } else {
          console.log('Shadow updated.')
          resolve(response)
        }
      }

      function shadowUpdateRejected(error, response) {
        if (response) {
          console.log("CreateShadow ErrorResponse for " +
            " statusCode=:" + response.statusCode +
            " errorCode=:" + response.errorCode +
            " errorMessage=:" + response.errorMessage)
        }
        if (error) {
          console.log("Error occurred..")
        }
        reject(error)
      }

      console.log(`Subscribing to ShadowUpdate Accepted and Rejected topics for ${config.hostname}..`)

      await shadow.subscribeToUpdateShadowAccepted(
        { thingName: config.hostname },
        mqtt.QoS.AtLeastOnce,
        shadowUpdateAccepted)

      await shadow.subscribeToUpdateShadowRejected(
        { thingName: config.hostname },
        mqtt.QoS.AtLeastOnce,
        shadowUpdateRejected)

      console.log("Publishing to ShadowUpdate topic..")

      await shadow.publishUpdateShadow(
        { thingName: config.hostname, state: buildShadow(config) },
        mqtt.QoS.AtLeastOnce)
    }
    catch (error) {
      reject(error)
    }
  })
}

function buildShadow(config) {
  return {
    "desired": {
      "modules": {},
      "island": {
        "name": config.hostname,
        "location": config.location ? config.location : "dev",
        "version": 1
      }
    },
    "reported": {}
  }
}

async function createKeys(connection, identity) {
  return new Promise(async (resolve, reject) => {
    try {

      function keysAccepted(error, response) {
        if (response) {
          console.log("CreateKeysAndCertificateResponse for certificateId=" + response.certificateId)
        }

        if (error || !response) {
          console.log("Error occurred..")
          reject(error)
        } else {
          resolve(response)
        }
      }

      function keysRejected(error, response) {
        if (response) {
          console.log("CreateKeysAndCertificate ErrorResponse for " +
            " statusCode=:" + response.statusCode +
            " errorCode=:" + response.errorCode +
            " errorMessage=:" + response.errorMessage)
        }
        if (error) {
          console.log("Error occurred..")
        }
        reject(error)
      }

      console.log("Subscribing to CreateKeysAndCertificate Accepted and Rejected topics..")

      const keysSubRequest = {}

      await identity.subscribeToCreateKeysAndCertificateAccepted(
        keysSubRequest,
        mqtt.QoS.AtLeastOnce,
        keysAccepted)

      await identity.subscribeToCreateKeysAndCertificateRejected(
        keysSubRequest,
        mqtt.QoS.AtLeastOnce,
        (error, response) => keysRejected(error, response))

      console.log("Publishing to CreateKeysAndCertificate topic..")
      const keysRequest = { toJSON() { return {}; } }

      await identity.publishCreateKeysAndCertificate(
        keysRequest,
        mqtt.QoS.AtLeastOnce)
    }
    catch (error) {
      reject(error)
    }
  })
}

export async function registerThing(identity, certId, certificateOwnershipToken) {
  return new Promise(async (resolve, reject) => {
    function registerAccepted(error, response) {
      if (response) {
        console.log("RegisterThingResponse for thingName=" + response.thingName);
      }

      if (error) {
        console.log("Error occurred..");
      }
      resolve();
    }

    function registerRejected(error, response) {
      if (response) {
        console.log("RegisterThing ErrorResponse for " +
          "statusCode=:" + response.statusCode +
          "errorCode=:" + response.errorCode +
          "errorMessage=:" + response.errorMessage);
      }
      if (error) {
        console.log("Error occurred..");
      }
      reject();
    }

    console.log("Subscribing to RegisterThing Accepted and Rejected topics..")
    const registerThingSubRequest = { templateName: "island" }
    await identity.subscribeToRegisterThingAccepted(
      registerThingSubRequest,
      mqtt.QoS.AtLeastOnce,
      (error, response) => registerAccepted(error, response))

    await identity.subscribeToRegisterThingRejected(
      registerThingSubRequest,
      mqtt.QoS.AtLeastOnce,
      (error, response) => registerRejected(error, response))

    console.log("Publishing to RegisterThing topic..");

    const registerThing = {
      parameters: {
        "AWS::IoT::Certificate::Id": certId,
        hostname: config.hostname
      },
      templateName: "island",
      certificateOwnershipToken
    }

    await identity.publishRegisterThing(
      registerThing,
      mqtt.QoS.AtLeastOnce)
  })
}

// lifted and modified from ../islands-rewrite/mqtt.js
// consolidate later...
export async function buildConnection() {
  // const level = parseInt(io.LogLevel["INFO"])
  // io.enable_logging(level)

  return new Promise(async (resolve, reject) => {
    try {
      let config_builder =
        iot.AwsIotMqttConnectionConfigBuilder.new_mtls_builder_from_path(config.provisioner.iot.certFilePath, config.provisioner.iot.privateKeyFilePath)

      config_builder.with_certificate_authority_from_path(undefined, config.provisioner.iot.awsCertFilePath)
      config_builder.with_clean_session(false)
      config_builder.with_client_id(config.provisioner.iot.name)
      config_builder.with_endpoint(config.provisioner.iot.endpoint)

      const clientConfig = config_builder.build()
      const client = new mqtt.MqttClient()
      const connection = client.new_connection(clientConfig)

      connection.on('closed', () => {
        console.log(`Connection closed.`)
      })

      connection.on('connect', (session_present) => {
        console.log(`Connected to MQTT ${session_present ? 'with a new' : 'with an existing'} session.`)
        resolve(connection)
      })

      connection.on('connection_failure', (err) => {
        console.log(`Failed to connect to MQTT: ${err}`)
        reject(err)
      })

      connection.on('disconnect', () => {
        console.log(`Disconnected from MQTT session.`)
      })

      connection.on('error', (err) => {
        console.log(`Error with MQTT session: ${err}`)
        reject(err)
      })

      connection.on('interrupt', (err) => {
        console.log(`MQTT session interrupted: ${err}`)
      })

      connection.on('resume', () => {
        console.log(`MQTT session resumed.`)
      })

      /*
      connection.on('message', (topic, msg) => {
        const enc = new TextDecoder("utf-8");
        console.log(`Message received: ${topic}, ${enc.decode(msg)}`)
      })
      */

      await connection.connect()
    } catch (e) {
      console.log(e)
      reject(e)
    }
  })
}
