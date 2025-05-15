import { mqtt } from "aws-iot-device-sdk-v2";

import set from "lodash/set.js";

let Switchbot;

import { globals } from "../index.js";
import { Module } from "../util/generic-module.js";
import { updateWholeShadow } from "../shadow.js";

export class Switchbots extends Module {
  constructor(stateKey) {
    super(stateKey);

    this.switchbot = undefined;
    this.paths = {
      enabled: { handler: this.handleEnabled, order: 0 },
    };
    this.bleInfo = {};
    this.isScanning = false;
  }

  getBot(id, state = this.currentState.switchbots) {
    return state.find((bot) => bot.id === id);
  }

  toUpDown(on, invert) {
    let off = !on;

    if ((on && !invert) || (off && invert)) {
      return "down";
    } else if ((off && !invert) || (on && invert)) {
      return "up";
    }
  }

  botToNameString(botOrId) {
    const bot = typeof botOrId === "string" ? this.getBot(botOrId) : botOrId;
    return `${bot.name} (${bot.id})`;
  }

  // this function is used when the island first comes up
  // bluetooth: current
  // state: desired
  async correctBotState(botId) {
    const bot = this.getBot(botId),
      current = this.bleInfo[botId].ble.on,
      desired = bot.on;

    if (current !== desired) {
      await this.setBotState(this.getBot(botId), current);
    } else {
      this.debug(
        {},
        `No action necessary for switchbot ${botToNameString(bot)}.`
      );
    }
  }

  findBotIndex(id) {
    return this.currentState.switchbots.findIndex((botToFind) => {
      return botToFind.id === id;
    });
  }

  // this function is used when the island receives mqtt messages on onTopic or offTopic
  // desiredState is a boolean here
  async mutateBotState(bot, desiredState) {
    const index = this.findBotIndex(bot.id);
    this.info(
      `Received MQTT request to change bot ${bot.id} (with index ${index}) from state ${bot.on} (${this.toUpDown(bot.on, bot.reverseOnOff)}) to state ${desiredState} (${this.toUpDown(desiredState, bot.reverseOnOff)}).`
    );
    // TODO: this is really broken and always believes that state.on is true
    // so let's bypass if for now and always attempt to set the switchbot state
    // if (state.on !== desiredState) {
    await this.setBotState(bot, bot.on, desiredState);
    this.info({}, `Updating shadow for index ${index} to ${desiredState}.`);
    let reported = set(
      {},
      `modules[${this.stateKey}].switchbots]`,
      this.currentState.switchbots
    );
    // TODO: this isn't quite right - it should use a sparse document instead of copying the whole document. Subtle bugs...
    reported = set(
      reported,
      `modules[${this.stateKey}].switchbots[${index}].on`,
      desiredState
    );
    updateWholeShadow({ reported: reported, desired: reported });
    // } else {
    // this.debug({}, `No action necessary for switchbot ${this.botToNameString(bot)}.`)
    // }
  }

  async pressBot(bot) {
    this.info(`Received MQTT request to press button.`);
    await this.bleInfo[bot.id].ble.press();
    this.debug(`Pressed button for bot ${this.botToNameString(bot)}.`);
  }

  // newState is "up" or "down" by this point
  async setBotState(bot, current, desired = bot.on) {
    this.debug(
      {},
      `Changing state from ${current ? "on" : "off"} (${this.toUpDown(current, bot.reverseOnOff)}) to ${desired ? "on" : "off"} (${this.toUpDown(desired, bot.reverseOnOff)}) for switchbot ${this.botToNameString(bot)}...`
    );
    if (this.isScanning)
      throw new Error("Attempting to scan and send commands simultaneously.");

    await this.bleInfo[bot.id].ble[this.toUpDown(desired, bot.reverseOnOff)]();

    bot.on = desired;

    this.debug(
      {},
      `Changed state from ${current ? "on" : "off"} (${this.toUpDown(current, bot.reverseOnOff)}) to ${desired ? "on" : "off"} (${this.toUpDown(desired, bot.reverseOnOff)}) for switchbot ${this.botToNameString(bot)}.`
    );
  }

  async enableBot(botId) {
    const promises = [],
      bot = this.getBot(botId),
      nameString = this.botToNameString(botId);

    await this.correctBotState(botId);

    if (bot.onTopic) {
      this.debug(
        `Subscribing bot ${nameString} to ON notifications on mqtt topic ${bot.onTopic}...`
      );
      promises.push(
        globals.connection
          .subscribe(
            bot.onTopic,
            mqtt.QoS.AtLeastOnce,
            this.mutateBotState.bind(this, bot, true)
          )
          .then(() =>
            this.debug(
              `Subscribed bot ${nameString} to ON notifications on mqtt topic ${bot.onTopic}.`
            )
          )
      );
    }

    if (bot.offTopic) {
      this.debug(
        `Subscribing bot ${nameString} to OFF notifications on mqtt topic ${bot.offTopic}...`
      );
      promises.push(
        globals.connection
          .subscribe(
            bot.offTopic,
            mqtt.QoS.AtLeastOnce,
            this.mutateBotState.bind(this, bot, false)
          )
          .then(() =>
            this.debug(
              `Subscribed bot ${nameString} to OFF notifications on mqtt topic ${bot.offTopic}.`
            )
          )
      );
    }

    if (bot.pressTopic) {
      this.debug(
        `Subscribing bot ${nameString} to PRESS notifications on mqtt topic ${bot.pressTopic}...`
      );
      promises.push(
        globals.connection
          .subscribe(
            bot.pressTopic,
            mqtt.QoS.AtLeastOnce,
            this.pressBot.bind(this, bot)
          )
          .then(() =>
            this.debug(
              `Subscribed bot ${nameString} to PRESS notifications on mqtt topic ${bot.pressTopic}.`
            )
          )
      );
    }

    return Promise.all(promises).then(() => this.enabled);
  }

  async scan() {
    return new Promise(async (resolve, reject) => {
      let idsToFind = this.currentState.switchbots.map((bot) => bot.id);
      let timeoutHandle;

      this.switchbot.onadvertisement = (ad) => {
        try {
          if (idsToFind.includes(ad.id)) {
            set(this.bleInfo, `${ad.id}.ad`, ad);
            idsToFind = idsToFind.filter((id) => id !== ad.id);
            this.debug(
              `Found device with id ${ad.id}. Still need to find ${idsToFind.join(", ")}.`
            );
          }

          if (idsToFind.length === 0) {
            this.debug(`All devices' ads received.`);
            this.switchbot.stopScan();
            this.switchbot.onadvertisement = undefined;
            this.isScanning = false;
            clearTimeout(timeoutHandle);
            resolve();
          }
        } catch (error) {
          this.error(error);
          reject(error);
        }
      };

      // TODO: we're not using bot.serviceData.battery or bot.serviceData.mode
      this.isScanning = true;
      await this.switchbot.startScan({ model: "H" });

      timeoutHandle = setTimeout(() => {
        this.switchbot.stopScan();
        this.isScanning = false;
        this.switchbot.onadvertisement = () => {};
        reject(
          new Error(
            `Only found ${Object.keys(this.bleInfo).length} / ${this.currentState.switchbots.length} switchbots.`
          )
        );
      }, 10 * 1000);
    });
  }

  async discover() {
    let idsToFind = this.currentState.switchbots.map((bot) => bot.id);
    const bots = await this.switchbot.discover({
      model: "H",
      duration: 2 * 1000,
    });

    for (let i = 0; i < bots.length; i++) {
      if (idsToFind.includes(bots[i].id)) {
        set(this.bleInfo, `${bots[i].id}.ble`, bots[i]);
        idsToFind = idsToFind.filter((id) => id !== bots[i].id);
        this.debug({}, `Discovered switchbot with id ${bots[i].id}.`);
      }
    }

    // TODO: Should this bail and not actually enable?
    if (idsToFind.length > 0) {
      const error = new Error(`Could not discover all requested switchbots.`);
      this.error(error);
      throw error;
    }

    this.info({}, `All switchbots discovered.`);
  }

  async startScan() {
    await this.scan();
    await this.discover();

    for (let i = 0; i < this.currentState.switchbots.length; i++) {
      await this.enableBot(this.currentState.switchbots[i].id);
    }

    this.info(
      {},
      `Enabled switchbots module, controlling ${Object.keys(this.bleInfo).length} bots.`
    );
  }

  async enable() {
    Switchbot = import("node-switchbot").Switchbot;
    this.switchbot = new Switchbot();
    this.info(
      {},
      `Enabling switchbots module to control ${this.currentState.switchbots ? this.currentState.switchbots.length : 0} bots...`
    );
    await this.startScan();
  }

  async disable() {
    this.info({}, `Disabling switchbots...`);
    this.switchbot = undefined;
    this.info({}, `Disabled switchbots.`);
  }
}

/*
{
  "enabled": true,
    "switchbots": [
      {
        "id": "f84e19c8c70d",
        "name": "test",
        "on": true,
        "onTopic": "dev/switch/on",
        "offTopic": "dev/switch/off",
        "pressTopic": "dev/press",
        "reverseOnOff": true
      }
    ]
}
*/

const switchbots = new Switchbots("switchbots");
export default switchbots;
