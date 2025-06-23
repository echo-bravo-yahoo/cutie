import Input from "../util/generic-input.js";

export default class Interval extends Input {
  constructor(config, task) {
    super(config, task);
  }

  register() {
    this.enable();
  }

  async enable() {
    this.interval = setInterval(
      this.handleMessage.bind(this, this.config.message),
      this.config.interval
    );
    this.info({}, `Enabled interval.`);
    this.enabled = true;
  }

  async handleMessage(message) {
    if (this.next) this.next.handleMessage(message);
  }

  async disable() {
    clearInterval(this.interval);
    this.info({}, `Disabled interval.`);
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
