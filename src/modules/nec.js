import { mqtt } from 'aws-iot-device-sdk-v2'

import { globals } from '../index.js'
import { Infrared } from './infrared.js'
import necPkg from '../../bitbang/adapters/nec.js'
const { transmitNECCommand } = necPkg

let pigpio, Gpio

export class NEC extends Infrared {
  constructor(stateKey) {
    super(stateKey)
  }

  runCommand(topicName, _body) {
    const body = JSON.parse(new TextDecoder().decode(_body))
    if (body.id) {
      this.runSavedCommand(body.id)
    } else {
      this.runNECCommand(body)
    }
  }

  runSavedCommand(id) {
    this.runNECCommand(this.currentState.savedCommands[id])
  }

  runNECCommand(body) {
    this.info({}, `Received NEC command with address 0x${Number(body.address).toString(16)} (extended/complement 0x${Number(body.extendedAddress ? body.extendedAddress : ~body.extendedAddress).toString(16)}) and command 0x${Number(body.command).toString(16)} (extended/complement 0x${Number(body.extendedAddress ? body.extendedAddress : ~body.extendedAdress).toString(16)}).`)

    if (this.currentState.virtual) return

    const address = typeof body.address === 'string' ? Number(body.address, 16) : body.address
    const command = typeof body.command === 'string' ? Number(body.command, 16) : body.command
    const extendedAddress = typeof body.extendedAddress === 'string' ? Number(body.extendedAddress, 16) : body.extendedAddress
    const extendedCommand = typeof body.extendedCommand === 'string' ? Number(body.extendedCommand, 16) : body.extendedCommand
    transmitNECCommand(pigpio, address, command, extendedAddress, extendedCommand)
      .then((waveId) => {
        this.info(`Done transmitting wave ${waveId}.`)
        try {
        pigpio.waveDelete(waveId)
        } catch (error) {
          console.log(error)
          console.log(JSON.stringify(error))
        }
      })
  }

  async enable(newState) {
    // TODO: init or enable?
    pigpio = import('pigpio').pigpio
    Gpio = pigpio.Gpio
    if (newState.commandTopic && (!this.currentState.enabled || newState.commandTopic !== this.currentState.commandTopic)) {
      this.debug(`Subscribing to NEC command requests on topic ${this.currentState.commandTopic}...`)
      await globals.connection.subscribe(this.currentState.commandTopic, mqtt.QoS.AtLeastOnce, this.runCommand.bind(this))
      this.debug(`Subscribed to NEC command requests on topic ${this.currentState.scriptTopic}.`)
    }

    super.enable(newState)
    this.info({}, `Enabled nec.`)
    this.currentState.enabled = true
  }

  // TODO: unsubscribe from commandTopic
  async disable() {
    super.disable()
    this.info({}, `Disabled nec.`)
    this.currentState.enabled = false
  }
}

/*
{
  "enabled": true,
  "pin": number,
  "commandTopic": string,
  "savedCommands": {
    "volumeDown": {
      "address": "0x7c",
      "command": "0x66",
      "extendedAddress": "0xaa"
    }
  }
}
*/

const nec = new NEC('nec')
export default nec
