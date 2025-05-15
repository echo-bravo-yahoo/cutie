import { Module } from './generic-module.js'

let pigpio, Gpio

export class Infrared extends Module {
  constructor(stateKey) {
    super(stateKey)

    this.paths = {
      'virtual': { handler: this.copyState, order: 0 },
      'enabled': { handler: this.handleEnabled, order: 1 },
      'ledPin': { handler: this.handleLedPin, order: 2 },
      'receiverPin': { handler: this.handleReceiverPin, order: 3 }
    }
  }

  handleLedPin(newState) {
    if (this.currentState.ledPin !== newState.ledPin) {
      console.log(`Changing infrared LED from pin ${this.currentState.ledPin} to ${newState.ledPin}.`)
      return this.enable(newState)
    }
  }

  handleReceiverPin(newState) {
    if (this.currentState.receiverPin !== newState.receiverPin) {
      console.log(`Changing infrared receiver from pin ${this.currentState.receiverPin} to ${newState.receiverPin}.`)
      return this.enable(newState)
    }
  }

  async enable(newState) {
    if (!newState.virtual) {
      pigpio = import('pigpio').pigpio
      Gpio = pigpio.Gpio

      if (newState.ledPin) {
        this.infraredLed = new Gpio(newState.ledPin, { mode: Gpio.OUTPUT })
        this.currentState.ledPin = newState.ledPin
        this.info({}, `Enabled infrared LED on pin ${newState.ledPin}.`)
      }
      if (newState.receiverPin) {
        this.infraredReceiver = new Gpio(newState.receiverPin, { mode: Gpio.INPUT })
        this.currentState.receiverPin = newState.receiverPin
        this.info({}, `Enabled infrared receiver on pin ${newState.receiverPin}.`)
      }
    }

    this.currentState.enabled = true
  }

  async disable() {
    if (this.infraredLed) {
      this.infraredLed = undefined
      this.currentState.ledPin = undefined
      this.info({}, `Disabled infrared LED.`)
    }
    if (this.infraredReceiver) {
      this.infraredReceiver = undefined
      this.currentState.receiverPin = undefined
      this.info({}, `Disabled infrared receiver.`)
    }
    this.currentState.enabled = false
  }
}

/*
{
  "enabled": boolean,
  "ledPin": number
}
*/

const infrared = new Infrared('infrared')
export default infrared

