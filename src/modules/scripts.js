import { mqtt } from 'aws-iot-device-sdk-v2'

import { execSync } from 'child_process'

import { globals } from '../index.js'
import { Config } from './generic-config.js'

import * as fs from 'fs';
import * as os from 'os';

export class Scripts extends Config {
  constructor(stateKey) {
    super(stateKey)
  }

  determineEnvironment() {
    let matched = []
    for (const [env, test] of Object.entries(this.currentState.environments)) {
      if (eval(test)()) matched.push(env)
    }

    if (matched.length === 0) {
      const error = new Error(`Could not find any matching environments for script running (looked in the set ${this.currentState.environments.join(', ')}.`)
      this.error(error)
      throw error
    }

    if (matched.length > 1) {
      const error = new Error(`Found multiple matching environments for script running (${matched.join(', ')}).`)
      this.error(error)
      throw error
    }

    return matched[0]
  }

  // args is a string by this point
  substituteArgs(scriptText, args) {
    if (scriptText.includes("ARGS")) {
      return scriptText.replace("ARGS", args)
    } else {
      return scriptText
    }
  }

  runScript(topicName, _body) {
    const body = JSON.parse(new TextDecoder().decode(_body))
    const scriptName = body.script

    if (!this.currentState.scripts[scriptName]) {
      const error = new Error(`No script found with name ${scriptName}.`)
      this.error(error)
      throw error
    }

    if (!this.currentState.scripts[scriptName][this.environment]) {
      const error = new Error(`Unable to run script ${scriptName} in environment ${this.environment}.`)
      this.error(error)
      throw error
    }

    this.info(`Running script ${scriptName} against environment ${this.environment}.`)
    let scriptText = this.currentState.scripts[scriptName][this.environment]
    scriptText = this.substituteArgs(scriptText, body.args)
    const stdout = execSync(scriptText)
    this.info({ stdout }, `Logs from running ${scriptName}`)
  }

  async init(newState) {
    this.debug(newState, `NEWSTATE`)
    this.currentState = newState
    this.environment = this.determineEnvironment()

    // TODO: init or enable?
    if (this.currentState.scriptTopic) {
      this.debug(`Subscribing to script run requests on topic ${this.currentState.scriptTopic}...`)
        await globals.connection.subscribe(this.currentState.scriptTopic, mqtt.QoS.AtLeastOnce, this.runScript.bind(this))
      this.debug(`Subscribed to script run requests on topic ${this.currentState.scriptTopic}.`)
    }
  }
}

const scripts = new Scripts('scripts')
export default scripts

/*
shadow state:
{
  "scriptTopic": "/dev/
  "scripts": {
    "turnOffMonitors": {
      "wsl": "nircmd.exe monitor off",
      "linux": "xset dpms force off"
    },
    "launchGame": {
      "wsl": "wsl() { /home/swift/workspace/steam-cli-venv/bin/steam-cli execute --name=$1 --games-dir=/mnt/i/games/steam/steamapps/common; }; wsl ARGS"
    }
  },
  "environments": {
    "wsl": "() => fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')",
    "linux": "() => os.platform() === 'linux && !fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')'
  }
}

mqtt message:
{
  "script": "turnOffMonitors"
}
*/
