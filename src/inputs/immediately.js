import Input from "../util/generic-input.js";

export default class Immediately extends Input {
  constructor(config, taskConfig) {
    super(config, taskConfig);
  }

  register() {
    this.enable();
  }

  async enable() {
    this.liveTask.postRegister = this.handleMessage.bind(
      this,
      this.config.message,
    );
    this.info({}, `Running immediate task.`);
    this.enabled = true;
  }

  async handleMessage(message) {
    console.log("!!!!");
    if (this.next) this.next.handleMessage(message);
  }

  async disable() {
    clearInterval(this.interval);
    this.info({}, `Skipping running immediate task.`);
    this.enabled = false;
  }
}

/*
{
  "type": "interval",
  "disabled": false,
  "message": { ... },
  "interval": 10000 // in ms
}
*/
