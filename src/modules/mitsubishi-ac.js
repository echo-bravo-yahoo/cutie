import { mqtt } from 'aws-iot-device-sdk-v2'

import { globals } from '../index.js'

import { Infrared } from './infrared.js'
import { Mitsubishi } from '../../bitbang/classes/Mitsubishi.js'

let pigpio

export class MitsubishiAC extends Infrared {
  constructor(stateKey) {
    super(stateKey)
    this.ac = new Mitsubishi()
  }

  async enable(newState) {
    let pigpio = import('pigpio').pigpio

    if (newState.commandTopic && (!this.currentState.enabled || newState.commandTopic !== this.currentState.commandTopic)) {
      this.debug(`Subscribing to NEC command requests on topic ${this.currentState.commandTopic}...`)
      await globals.connection.subscribe(this.currentState.commandTopic, mqtt.QoS.AtLeastOnce, this.sendCommand.bind(this))
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

  sendCommand(topicName, _body) {
    const command = JSON.parse(new TextDecoder().decode(_body))
    this.ac.transmitCommand(command, pigpio)
  }
}

/*
{
  "enabled": boolean,
  "ledPin": number,
  "topicName": string
}
*/

const mitsubishiAC = new MitsubishiAC('mitsubishiAC')
export default mitsubishiAC


