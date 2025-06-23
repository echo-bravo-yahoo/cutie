import Output from "../util/generic-output.js";

export default class Console extends Output {
  constructor(config, task) {
    super(config, task);
  }

  async register() {}

  async enable() {}

  async disable() {}

  async send(message) {
    console.log(
      `CONSOLE OUTPUT: ${JSON.stringify(message, null, this.config.spaces || 0)}`,
    );
  }
}

/*
{
  "type": "output:console",
  "disabled": false,
  "spaces": number
}
*/
